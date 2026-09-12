import test from "node:test";
import assert from "node:assert/strict";
import {MockPeriodicAgent, initialAgentCycle} from "../src/lib/periodic-agent/mock";
import {blackboxRecord} from "../src/lib/blackbox/batch-stream";
import type {BlackboxBatch} from "../src/lib/blackbox/types";
import {liveSample} from "../src/lib/live-telemetry";
const batch=(id:string):BlackboxBatch=>({schemaVersion:1,batchId:id,vehicleId:"bmw-m2",source:"simulated",sampleIntervalMs:1000,recordCount:15,records:Array.from({length:15},(_,i)=>blackboxRecord(liveSample("normal","bmw-m2",i,new Date(1700000000000+i*1000))))});
const settled=()=>new Promise(resolve=>setTimeout(resolve,45));
test("one batch creates one delayed normal reply with frozen evidence and real batch identity",async()=>{
 let state=initialAgentCycle();const snapshot=()=>state;const phases:string[]=[];
 const agent=new MockPeriodicAgent("bmw-m2",s=>{state=s;phases.push(s.phase);},24);agent.start();
 assert.equal(snapshot().response,null);const input=batch("batch-1");agent.submit(input);
 assert.equal(snapshot().phase,"sending");assert.equal(snapshot().response,null);
 input.records[0].coolant=200;await settled();
 assert.deepEqual(phases,["collecting","sending","analyzing","ready"]);
 assert.equal(snapshot().response?.batchId,"batch-1");assert.equal(snapshot().response?.cycle,1);
 assert.equal(snapshot().response?.vehicleId,"bmw-m2");assert.equal(snapshot().response?.observations[0].value.includes("200"),false);
 assert.equal(snapshot().history.length,1);agent.submit(batch("batch-1"));await settled();assert.equal(snapshot().history.length,1);
 const old=snapshot().response;agent.submit(batch("batch-2"));assert.deepEqual(snapshot().response,old);
 await settled();assert.equal(snapshot().response?.cycle,2);assert.equal(snapshot().history.length,2);
 agent.dispose();
});
test("offline/disposal cancels pending work and does not show a late healthy response",async()=>{
 let state=initialAgentCycle();const snapshot=()=>state;let updates=0;
 const agent=new MockPeriodicAgent("bmw-m2",s=>{state=s;updates++;},24);agent.start();agent.submit(batch("interrupted"));agent.pause();
 await settled();assert.equal(snapshot().phase,"paused");assert.equal(snapshot().response,null);
 agent.resume();agent.submit(batch("next"));agent.dispose();const count=updates;
 await settled();assert.equal(updates,count);assert.equal(snapshot().response,null);
});
test("wrong-vehicle, incomplete, faulted and overheated batches cannot receive a normal fixture",async()=>{
 let state=initialAgentCycle();const agent=new MockPeriodicAgent("bmw-m2",s=>{state=s;},24);agent.start();
 agent.submit({...batch("other"),vehicleId:"other-car"});
 const incomplete=batch("short");incomplete.records.pop();agent.submit(incomplete);
 const fault=batch("fault");fault.records[0].fault=1;agent.submit(fault);
 const hot=batch("hot");hot.records[0].coolant=120;agent.submit(hot);
 await settled();assert.equal(state.response,null);assert.equal(state.phase,"collecting");agent.dispose();
});
test("history stays bounded and restarting does not reuse old replies",async()=>{
 let state=initialAgentCycle();const agent=new MockPeriodicAgent("bmw-m2",s=>{state=s;},6);agent.start();
 for(let i=0;i<7;i++){agent.submit(batch(`history-${i}`));await settled();}
 assert.equal(state.history.length,5);assert.equal(state.response?.cycle,7);
 agent.dispose();agent.start();assert.equal(state.history.length,0);assert.equal(state.response,null);agent.dispose();
});
