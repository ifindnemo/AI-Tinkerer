import test from 'node:test';
import assert from 'node:assert/strict';
import {BatchGateway} from '../src/lib/backend/batch-gateway';
import {validateBatch} from '../src/lib/backend/contract';
import {blackboxRecord} from '../src/lib/blackbox/batch-stream';
import {liveSample} from '../src/lib/live-telemetry';
import type {BlackboxBatch} from '../src/lib/blackbox/types';
const batch=():BlackboxBatch=>({schemaVersion:1,batchId:'test-batch',vehicleId:'bmw-m2',source:'simulated',sampleIntervalMs:1000,recordCount:15,records:Array.from({length:15},(_,i)=>blackboxRecord(liveSample('normal','bmw-m2',i,new Date(1700000000000+i*1000))))});
const normal={status:'normal',vehicle_id:'bmw-m2',batch_id:'test-batch',accepted_records:15,assessment:{severity:'normal',diagnosis:'Vehicle stable',suspected_faults:[],evidence:['stable temperature'],confidence:0.8,missing_data:[],recommendations:['Continue monitoring']},hard_safety_guardrail:{triggered:false,minimum_severity:'normal',reasons:[]},tool_trace:[],memory:null,sanitization:{removed_fields:['fault'],removed_values:15}};
test('gateway preserves raw units and sensor-only schema without converting workbook values',()=>{
 const b=batch();const payload=validateBatch({...b,analysis:'must not leave frontend'});
 assert.equal(payload.records.length,15);assert.equal(payload.records[0].units.speed,'raw');assert.equal(payload.records[0].speed,b.records[0].speed);assert.equal('analysis' in payload,false);
 assert.equal('assessment' in payload.records[0],false);assert.equal('ambient' in payload.records[0],false);
});
test('gateway rejects invalid final sample before any backend request',async()=>{
 let calls=0;const gateway=new BatchGateway(async()=>{calls++;return Response.json(normal);});
 const invalid=batch();invalid.records[14].coolant=NaN;assert.equal((await gateway.submit(invalid)).status,422);assert.equal(calls,0);
});
test('one complete batch makes one native backend request and duplicate retries reuse it',async()=>{
 let calls=0;const gateway=new BatchGateway(async(path,value)=>{assert.equal(path,'/api/telemetry/batch');assert.deepEqual(value,batch());calls++;await new Promise(r=>setTimeout(r,10));return Response.json(normal);});
 const [a,b]=await Promise.all([gateway.submit(batch()),gateway.submit(batch())]);assert.equal(a.status,200);assert.deepEqual(a,b);assert.equal(calls,1);
});
test('the language the agent should answer in is passed on only when it is English, and nothing else is let through',async()=>{
 const seen:unknown[]=[];const gateway=new BatchGateway(async(_path,value)=>{seen.push(value);return Response.json(normal);});
 assert.equal((await gateway.submit({...batch(),lang:'en'})).status,200);
 assert.equal((await gateway.submit({...batch(),lang:'vi'})).status,200);
 assert.equal((seen[0] as {lang?:string}).lang,'en');
 assert.equal('lang' in (seen[1] as object),false,'Vietnamese is the backend default: the wire format is unchanged');
 assert.equal('lang' in validateBatch({...batch(),lang:'fr'}),false,'an unknown language falls back to the default');
 assert.equal('lang' in validateBatch(batch()),false);
});
test('backend failure is visible and not automatically replayed',async()=>{
 let calls=0;const gateway=new BatchGateway(async()=>{calls++;return new Response('private diagnostic details',{status:502});});
 const result=await gateway.submit(batch());assert.equal(result.status,502);assert.equal(JSON.stringify(result).includes('private diagnostic'),false);await gateway.submit(batch());assert.equal(calls,1);
});
test('gateway rejects responses for another vehicle or batch',async()=>{
 const gateway=new BatchGateway(async()=>Response.json({...normal,vehicle_id:'other-car'}));assert.equal((await gateway.submit(batch())).status,502);
 const wrongBatch=new BatchGateway(async()=>Response.json({...normal,batch_id:'other-batch'}));assert.equal((await wrongBatch.submit(batch())).status,502);
});
test('local origin check accepts Next internal bind URL and hides vendor credentials',async()=>{
 const {sameOrigin,publicPayload}=await import('../src/lib/backend/proxy');
 assert(sameOrigin(new Request('http://0.0.0.0:3000/api/vehicle/telemetry',{headers:{host:'localhost:3000',origin:'http://localhost:3000'}})));
 assert(!sameOrigin(new Request('http://0.0.0.0:3000/api/vehicle/telemetry',{headers:{host:'localhost:3000',origin:'https://unrelated.example'}})));
 const clean=JSON.stringify(publicPayload({diagnosis:'See https://vendor.example/?key=private-token&lat=1',tool_trace:[{result:{error:'private failure'}}]}));assert(!clean.includes('private-token'));assert(!clean.includes('private failure'));
});
test('gateway accepts an early 5-sample batch and requires the backend to confirm the same count',async()=>{
 const early=():BlackboxBatch=>{const b=batch();return {...b,recordCount:5,records:b.records.slice(0,5)};};
 assert.equal(validateBatch(early()).recordCount,5);
 const ok=new BatchGateway(async()=>Response.json({...normal,accepted_records:5}));const result=await ok.submit(early());
 assert.equal(result.status,200);assert.equal((result.body as {accepted:number}).accepted,5);
 const mismatch=new BatchGateway(async()=>Response.json(normal));assert.equal((await mismatch.submit(early())).status,502);
 const tooSmall=batch();tooSmall.records=tooSmall.records.slice(0,4);tooSmall.recordCount=4;assert.throws(()=>validateBatch(tooSmall));
 const wrongCount=batch();wrongCount.recordCount=14;assert.throws(()=>validateBatch(wrongCount));
});
