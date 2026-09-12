import test from "node:test";
import assert from "node:assert/strict";
import { liveSample } from "../src/lib/live-telemetry";
import { analyzeTelemetry } from "../src/lib/telemetry";
test("live stream stays scoped to the selected car and advances packet data", () => {
 const first = liveSample("normal", "bmw-m2", 0);
 const next = liveSample("normal", "bmw-m2", 1, new Date(Date.now() + 2000));
 assert.equal(next.vehicleId,"bmw-m2");
 assert(Math.abs(first.rpm-next.rpm)<=25);
 assert.notEqual(first.capturedAt,next.capturedAt);
 assert.equal(next.fault,0);
 assert.throws(()=>liveSample("normal","missing-car",1));
});
test("scenario classification remains coherent over a ten-minute stream", () => {
 for(const [scenario,cause,fault] of [["normal","normal",0],["environment","environment",0],["engine","engine",1]] as const){
  for(const tick of [0,1,30,150,300,500]){
   const t=liveSample(scenario,"bmw-m2",tick);
   assert.equal(t.fault,fault);assert.equal(analyzeTelemetry(t).cause,cause);
  }
 }
 assert.throws(()=>analyzeTelemetry(liveSample("offline","bmw-m2",3)));
});

test("filtered workbook ranges bound a smooth per-car stream without assigning unknown units", async () => {
 const {operatingRanges, operatingUnit} = await import("../src/lib/telemetry-profile");
 let previous=liveSample("normal","bmw-m2",0);
 const observed={rpm:[previous.rpm],map:[previous.map!],tps:[previous.tps!],speed:[previous.speed],consumption:[previous.consumption!]};
 for(let tick=1;tick<=3600;tick++){
  const packet=liveSample("normal","bmw-m2",tick);
  assert.equal(packet.operatingSource,"excel-range");
  assert.equal(packet.vehicleId,"bmw-m2");
  for(const key of ["rpm","map","tps","speed","consumption"] as const){
   const [low,high]=operatingRanges[key].range;
   assert(packet[key]!>=low && packet[key]!<=high,`${key} stays inside the filtered reference range`);
   assert(Math.abs(packet[key]!-previous[key]!) <= (high-low)*.06+1,`${key} does not jump between samples`);
  }
  for(const key of ["rpm","map","tps","speed","consumption"] as const)observed[key].push(packet[key]!);
  previous=packet;
 }
 const span=(values:number[])=>Math.max(...values)-Math.min(...values);
 assert(span(observed.rpm)<=25);
 assert(span(observed.map)<=.02);
 assert(span(observed.tps)<=.02);
 assert(span(observed.speed)<=.6);
 assert(span(observed.consumption)<=.06);
 assert.equal(operatingUnit(previous,"map"),"raw");
 assert.equal(operatingUnit(previous,"tps"),"raw");
 assert.equal(operatingUnit(previous,"speed"),"raw");
 assert.equal(operatingUnit(previous,"consumption"),"L/h");
 const incidentPacket=liveSample("engine","bmw-m2",2);
 assert.equal(incidentPacket.operatingSource,"scenario");
 assert.equal(operatingUnit(incidentPacket,"map"),"kPa");
 assert.equal(operatingUnit(incidentPacket,"speed"),"km/h");
});
