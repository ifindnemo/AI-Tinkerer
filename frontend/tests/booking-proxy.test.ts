import test from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../src/app/api/vehicle/[...path]/route';

// The only write the browser may make through the proxy is the confirmation of a pending booking.
const post=(path:string,body:unknown)=>POST(new Request(`http://localhost/api/vehicle/${path}`,{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({path:path.split('/')})});

test('confirmation accepts only the pending action id',async()=>{
 for(const body of [{},{pending_action_id:'x'},{pending_action_id:'act_0123456789ab',slot:'2030-01-01T00:00:00Z'},{pending_action_id:'act_0123456789ab/../'},[]]){
  assert.equal((await post('incidents/inc_abc/confirm',body)).status,400,JSON.stringify(body));
 }
});

test('other writes stay blocked',async()=>{
 assert.equal((await post('incidents/inc_abc/action',{action:'book_appointment',garage_id:'g',slot:'2030-01-01T00:00:00Z'})).status,404);
 assert.equal((await post('appointments/apt_0123456789ab',{})).status,404);
});
