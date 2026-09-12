import test from "node:test";
import assert from "node:assert/strict";
import {createIncident, incidentReport, observeIncident, simulateIncidentPacket, transitionIncident, type SafetyIncident, type SimulationPhase} from "../src/lib/safety-agent";
import {liveSample} from "../src/lib/live-telemetry";
import {executeMockSafetyTool} from "../src/lib/mock-safety-tools";
const start=()=>createIncident("incident-1","bmw-m2","BMW M2 Coupé");
function observe(s: SafetyIncident){return observeIncident(s,simulateIncidentPacket(liveSample("engine","bmw-m2",0),s));}
function simulate(s: SafetyIncident,phase: SimulationPhase){return observe(transitionIncident(s,{type:"SIMULATE",phase}));}
function finish(s: SafetyIncident){const action=s.action!;s=transitionIncident(s,{type:"CONFIRM",actionId:action.id});return transitionIncident(s,{type:"TOOL_SUCCESS",actionId:action.id,result:{requestId:"demo-result",message:"Mock action completed"}});}
test("driver acknowledgement does not change vehicle telemetry or escalate by itself",()=>{
 const s=observe(start());const ack=transitionIncident(s,{type:"ACKNOWLEDGE"});
 assert.equal(ack.packet?.speed,65);assert.equal(ack.severity,"HIGH");assert.equal(ack.action,null);
 assert.equal(observe(ack).packet?.speed,65);
 assert.equal(transitionIncident(ack,{type:"ACKNOWLEDGE"}),ack);
});
test("one incident follows observed response, confirmation, rescue and stabilization",()=>{
 let s=simulate(observe(start()),"slowing");
 assert.equal(s.packet?.speed,28);assert.equal(s.packet?.coolant,112);assert.equal(s.status,"WAITING_CONFIRMATION");assert.equal(s.severity,"CRITICAL");
 assert.equal(s.action?.kind,"NAVIGATE_SAFE_STOP");
 const count=s.timeline.length;for(let i=0;i<10;i++)s=observe(s);assert.equal(s.timeline.length,count);
 s=finish(s);assert.equal(s.navigationDone,true);
 s=simulate(s,"stopped");assert.equal(s.packet?.speed,0);assert.equal(s.action?.kind,"CREATE_RESCUE_REQUEST");
 s=finish(s);assert.equal(s.rescueDone,true);
 s=simulate(s,"cooling");assert.equal(s.status,"STABILIZING");
 for(let i=0;i<5;i++)s=observe(s);
 assert.equal(s.status,"RESOLVED");assert.equal(s.id,"incident-1");
 assert.equal(s.packet?.fault,1,"stabilization is not mechanical repair");
 assert.equal(incidentReport(s.packet!,s).severity,"watch");
});
test("decline makes no request and reopen keeps the consent payload",()=>{
 let s=simulate(start(),"slowing");const action=s.action!;
 s=transitionIncident(s,{type:"DECLINE",actionId:action.id});assert.equal(s.action?.status,"declined");assert.equal(s.navigationDone,false);
 s=observe(s);assert.equal(s.action?.status,"declined");
 s=transitionIncident(s,{type:"REOPEN",actionId:action.id});assert.deepEqual(s.action?.payload,action.payload);
});
test("duplicate confirm and unsolicited tool results cannot execute or mark success",()=>{
 let s=simulate(start(),"slowing");const id=s.action!.id;
 assert.equal(transitionIncident(s,{type:"TOOL_SUCCESS",actionId:id,result:{requestId:"wrong",message:"wrong"}}),s);
 s=transitionIncident(s,{type:"CONFIRM",actionId:id});assert.equal(transitionIncident(s,{type:"CONFIRM",actionId:id}),s);
 s=transitionIncident(s,{type:"TOOL_FAILURE",actionId:id,error:"mock unavailable"});assert.equal(s.action?.status,"failed");
 const retried=transitionIncident(s,{type:"CONFIRM",actionId:id});assert.equal(retried.action?.id,id);assert.equal(retried.action?.status,"pending");
});
test("stopping invalidates navigation results and unrelated vehicle packets are ignored",()=>{
 let s=simulate(start(),"slowing");const oldId=s.action!.id;s=transitionIncident(s,{type:"CONFIRM",actionId:oldId});
 s=simulate(s,"stopped");assert.equal(s.action?.kind,"CREATE_RESCUE_REQUEST");
 assert.equal(transitionIncident(s,{type:"TOOL_SUCCESS",actionId:oldId,result:{requestId:"late",message:"late"}}),s);
 assert.equal(observeIncident(s,{...s.packet!,vehicleId:"another-car"}),s);
 assert.equal(observeIncident(s,{...s.packet!,connected:false}),s);
});
test("mock tool requires confirmed action and respects cancellation",async()=>{
 const s=simulate(start(),"slowing");const c=new AbortController();
 await assert.rejects(executeMockSafetyTool(s.action!,c.signal),/confirmed/);
 const pending=transitionIncident(s,{type:"CONFIRM",actionId:s.action!.id});
 const request=executeMockSafetyTool(pending.action!,c.signal);c.abort();await assert.rejects(request,{name:"AbortError"});
});
