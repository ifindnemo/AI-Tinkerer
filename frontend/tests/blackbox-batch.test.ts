import test from "node:test";
import assert from "node:assert/strict";
import {BlackboxBatchStream,blackboxRecord} from "../src/lib/blackbox/batch-stream";
import {initialTransfer} from "../src/lib/blackbox/types";
import {liveSample} from "../src/lib/live-telemetry";
const start=Date.parse("2026-09-12T00:00:00Z");
const packet=(second:number)=>liveSample("normal","bmw-m2",second,new Date(start+second*1000));

test("one-second blackbox samples produce independent batches of exactly 15 whitelisted records",()=>{
 let state=initialTransfer();const snapshot=()=>state;const stream=new BlackboxBatchStream("bmw-m2",s=>{state=s;});stream.start();
 for(let second=1;second<15;second++)stream.push(packet(second));
 assert.equal(state.buffered,14);assert.equal(snapshot().lastBatch,null);
 stream.push(packet(15));const first=snapshot().lastBatch!;
 assert.equal(first.recordCount,15);assert.equal(first.records.length,15);assert.equal(state.buffered,0);
 assert.equal(first.sampleIntervalMs,1000);assert.equal(first.vehicleId,"bmw-m2");
 for(let i=1;i<15;i++)assert.equal(Date.parse(first.records[i].capturedAt)-Date.parse(first.records[i-1].capturedAt),1000);
 for(let second=16;second<=30;second++)stream.push(packet(second));
 assert.notEqual(snapshot().lastBatch?.batchId,first.batchId);
 assert.equal(snapshot().lastBatch?.records[0].capturedAt,packet(16).capturedAt);
 assert.equal(first.records[0].capturedAt,packet(1).capturedAt,"completed batch stays unchanged");
 const record=blackboxRecord({...packet(1),scenario:"engine"});
 assert.deepEqual(Object.keys(record).sort(),["capturedAt","rpm","map","tps","engineLoad","consumption","speed","coolant","oil","intake","battery","fuel","fan","fault","dtc","location","units"].sort());
 assert.equal(record.units.map,"raw");assert.equal(record.units.tps,"raw");
 assert.equal("scenario" in record,false);assert.equal("ambient" in record,false);assert.equal("coolantTrend" in record,false);
 stream.dispose();
});
test("duplicates, wrong vehicles, invalid samples and gaps cannot create fabricated complete batches",()=>{
 let state=initialTransfer();const snapshot=()=>state;const stream=new BlackboxBatchStream("bmw-m2",s=>{state=s;});stream.start();
 stream.push(packet(1));stream.push(packet(1));stream.push({...packet(2),vehicleId:"other"});stream.push({...packet(2),connected:false});
 assert.equal(state.buffered,1);
 stream.push({...packet(2),rpm:NaN});assert.equal(state.buffered,0);
 stream.push(packet(3));stream.push(packet(10));assert.equal(state.buffered,1,"long gap restarts collection");
 stream.breakSequence();assert.equal(state.buffered,0);assert.equal(snapshot().lastBatch,null);
 stream.dispose();stream.push(packet(11));assert.equal(state.buffered,0);
 stream.start();assert.equal(snapshot().lastBatch,null);stream.dispose();
});
