import test from "node:test";
import assert from "node:assert/strict";
import {MockVehicleSessionAdapter} from "../src/lib/vehicle-session/mock-adapter";
import {decodeSession} from "../src/lib/vehicle-session/repository";
import type {SessionRepository, StoredSession} from "../src/lib/vehicle-session/types";
import {vehicles} from "../src/lib/vehicles";
import {transitionIncident, observeIncident, simulateIncidentPacket} from "../src/lib/safety-agent";
const vehicle=vehicles[0];
const nextPacket=()=>new Promise(resolve=>setTimeout(resolve,20));
class MemoryRepository implements SessionRepository {
  records=new Map<string,string>();
  load(id:string){return decodeSession(this.records.get(id)??null,id);}
  save(s:StoredSession){this.records.set(s.vehicleId,JSON.stringify(s));}
}
async function proposal(repo:MemoryRepository){
  const adapter=new MockVehicleSessionAdapter(vehicle,repo);
  adapter.start();await nextPacket();adapter.setScenario("engine");
  adapter.command({type:"ACKNOWLEDGE"});adapter.command({type:"SIMULATE",phase:"slowing"});
  return adapter;
}
test("SSR snapshot is deterministic and storage is only accessed after start",()=>{
  const repo:SessionRepository={load(){throw Error("unavailable");},save(){throw Error("unavailable");}};
  const a=new MockVehicleSessionAdapter(vehicle,repo),b=new MockVehicleSessionAdapter(vehicle,repo);
  assert.deepEqual(a.getServerSnapshot(),b.getServerSnapshot());
  assert.equal(a.getSnapshot().telemetry.connected,false);
  assert.equal(a.getSnapshot().telemetry.capturedAt,"");
});
test("reload preserves consent, acknowledgement, incident identity and history without presenting cached telemetry as live",async()=>{
  const repo=new MemoryRepository();const first=await proposal(repo);first.dispose();
  const previous=first.getSnapshot();const restored=new MockVehicleSessionAdapter(vehicle,repo);
  try{
    restored.start();const initial=restored.getSnapshot();
    assert.equal(initial.telemetry.connected,false);assert.equal(initial.result,null);assert.deepEqual(initial.samples,[]);
    assert.deepEqual(initial.incident,previous.incident);assert.deepEqual(initial.history,previous.history);
    await nextPacket();const live=restored.getSnapshot();
    assert.equal(live.telemetry.connected,true);assert.equal(live.incident?.driverAcknowledged,true);
    assert.deepEqual(live.incident?.action,previous.incident?.action);
    assert.deepEqual(live.incident?.timeline,previous.incident?.timeline);
    assert.equal(live.history.length,previous.history.length);
  }finally{restored.dispose();}
});
test("pending is persisted before execution; reload requires explicit retry with the original payload",async()=>{
  const repo=new MemoryRepository();const first=await proposal(repo);const action=first.getSnapshot().incident!.action!;
  first.command({type:"CONFIRM",actionId:action.id});
  assert.equal(repo.load(vehicle.id)?.incident?.action?.status,"pending");first.dispose();
  const restored=new MockVehicleSessionAdapter(vehicle,repo);
  try{
    restored.start();await nextPacket();
    assert.equal(restored.getSnapshot().incident?.action?.status,"failed");
    assert.match(restored.getSnapshot().recoveryNotice,/gián đoạn/);
    assert.deepEqual(restored.getSnapshot().incident?.action?.payload,action.payload);
    await new Promise(resolve=>setTimeout(resolve,1600));
    assert.equal(restored.getSnapshot().incident?.action?.status,"failed","no automatic resend or late completion");
    restored.command({type:"CONFIRM",actionId:action.id});
    await new Promise(resolve=>setTimeout(resolve,1600));
    assert.equal(restored.getSnapshot().incident?.action?.status,"succeeded");
    assert.equal(restored.getSnapshot().incident?.action?.id,action.id);
  }finally{restored.dispose();}
});
test("declined, failed, succeeded and resolved incidents restore without changing consent or duplicating timeline",async()=>{
  for(const status of ["declined","failed","succeeded","resolved"] as const){
    const repo=new MemoryRepository();const a=await proposal(repo);a.dispose();const saved=repo.load(vehicle.id)!;
    let incident=saved.incident!;const id=incident.action!.id;
    if(status==="declined")incident=transitionIncident(incident,{type:"DECLINE",actionId:id});
    else{
      incident=transitionIncident(incident,{type:"CONFIRM",actionId:id});
      incident=transitionIncident(incident,status==="failed"?{type:"TOOL_FAILURE",actionId:id,error:"demo failure"}:{type:"TOOL_SUCCESS",actionId:id,result:{requestId:"saved-result",message:"Demo completed"}});
      if(status==="resolved"){
        incident=transitionIncident(incident,{type:"SIMULATE",phase:"stopped"});
        incident=observeIncident(incident,simulateIncidentPacket(saved.telemetry,incident));
        const rescueId=incident.action!.id;
        incident=transitionIncident(incident,{type:"CONFIRM",actionId:rescueId});
        incident=transitionIncident(incident,{type:"TOOL_SUCCESS",actionId:rescueId,result:{requestId:"rescue-result",message:"Demo rescue"}});
        incident=transitionIncident(incident,{type:"SIMULATE",phase:"cooling"});
        for(let i=0;i<6;i++)incident=observeIncident(incident,simulateIncidentPacket(saved.telemetry,incident));
      }
    }
    repo.save({...saved,incident});incident=repo.load(vehicle.id)!.incident!;const restored=new MockVehicleSessionAdapter(vehicle,repo);
    try{
      restored.start();assert.deepEqual(restored.getSnapshot().incident,incident);
      await nextPacket();assert.deepEqual(restored.getSnapshot().incident?.action,incident.action);
      assert.equal(restored.getSnapshot().incident?.id,incident.id);
      if(status==="resolved")assert.equal(restored.getSnapshot().incident?.status,"RESOLVED");
      else assert.deepEqual(restored.getSnapshot().incident?.timeline,incident.timeline);
    }finally{restored.dispose();}
  }
});
test("offline reload stays disconnected and preserves the last packet time and pending proposal",async()=>{
  const repo=new MemoryRepository();const a=await proposal(repo);a.setScenario("offline");a.dispose();
  const before=a.getSnapshot();const restored=new MockVehicleSessionAdapter(vehicle,repo);
  try{
    restored.start();await nextPacket();
    assert.equal(restored.getSnapshot().scenario,"offline");assert.equal(restored.getSnapshot().telemetry.connected,false);
    assert.equal(restored.getSnapshot().telemetry.capturedAt,before.telemetry.capturedAt);
    restored.command({type:"CONFIRM",actionId:before.incident!.action!.id});
    assert.equal(restored.getSnapshot().incident?.action?.status,"proposed");
    restored.setScenario("engine");assert.equal(restored.getSnapshot().incident?.id,before.incident?.id);
  }finally{restored.dispose();}
});
test("vehicle sessions stay isolated and disposed adapters publish no async updates",async()=>{
  const repo=new MemoryRepository();const a=await proposal(repo);let updates=0;
  const unsubscribe=a.subscribe(()=>updates++);const id=a.getSnapshot().incident!.action!.id;
  a.command({type:"CONFIRM",actionId:id});a.dispose();const count=updates;unsubscribe();
  vehicles.push({...vehicle,id:"other-car"});
  const other=new MockVehicleSessionAdapter(vehicles[vehicles.length-1],repo);
  try{
    other.start();assert.equal(other.getSnapshot().incident,null);assert.deepEqual(other.getSnapshot().history,[]);
    await nextPacket();assert.equal(updates,count);assert.equal(repo.load(vehicle.id)?.incident?.action?.status,"pending");
  }finally{other.dispose();vehicles.pop();}
});
test("invalid or incompatible saved records are preserved and storage failures remain visible",async()=>{
  const repo=new MemoryRepository();const a=await proposal(repo);a.dispose();const valid=repo.load(vehicle.id)!;
  for(const raw of ["{broken",JSON.stringify({...valid,version:2}),JSON.stringify({...valid,vehicleId:"wrong"}),JSON.stringify({...valid,incident:{...valid.incident,action:{...valid.incident!.action,payload:{...valid.incident!.action!.payload,vehicleId:"wrong"}}}})]){
    assert.throws(()=>decodeSession(raw,vehicle.id));repo.records.set(vehicle.id,raw);
    const restored=new MockVehicleSessionAdapter(vehicle,repo);
    try{restored.start();await nextPacket();assert.match(restored.getSnapshot().storageError,/không hợp lệ/);assert.equal(repo.records.get(vehicle.id),raw);}
    finally{restored.dispose();}
  }
  const blocked=new MockVehicleSessionAdapter(vehicle,{load:()=>null,save(){throw Error("quota");}});
  try{blocked.start();await nextPacket();assert.equal(blocked.getSnapshot().telemetry.connected,true);assert.match(blocked.getSnapshot().storageError,/Không lưu/);}
  finally{blocked.dispose();}
});
