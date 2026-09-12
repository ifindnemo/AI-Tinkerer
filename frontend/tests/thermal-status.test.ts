import test from "node:test";
import assert from "node:assert/strict";
import {getMockTelemetry} from "../src/lib/telemetry";
import {thermalLevel} from "../src/lib/thermal-status";
import {createIncident,simulateIncidentPacket} from "../src/lib/safety-agent";

test("thermal colors distinguish normal operation, environmental warmth, and multi-signal overheating",()=>{
 const normal=getMockTelemetry("normal");
 const ambient=getMockTelemetry("environment");
 const hot=simulateIncidentPacket(getMockTelemetry("engine"),createIncident("test","bmw-m2","BMW"));
 for(const sensor of ["engine","cooling"] as const){
  assert.equal(thermalLevel(normal,sensor),"normal");
  assert.equal(thermalLevel(ambient,sensor),"watch");
  assert.equal(thermalLevel(hot,sensor),"danger");
  assert.equal(thermalLevel({...hot,connected:false},sensor),"unknown");
  assert.equal(thermalLevel({...normal,fault:3},sensor),"normal","Fault does not determine heat severity");
 }
});
test("cooling clears danger and each sensor has an independent state",()=>{
 const normal=getMockTelemetry("normal");
 const cooling={...normal,coolant:98,oil:105,coolantTrend:0,fan:0,fault:1 as const};
 assert.equal(thermalLevel(cooling,"engine"),"normal");assert.equal(thermalLevel(cooling,"cooling"),"normal");
 assert.equal(thermalLevel({...normal,oil:130},"engine"),"danger");
 assert.equal(thermalLevel({...normal,oil:130},"cooling"),"normal");
 assert.equal(thermalLevel({...normal,coolant:NaN},"cooling"),"unknown");
});
