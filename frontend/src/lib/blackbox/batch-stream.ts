import type {Telemetry} from "../telemetry";
import {BLACKBOX_BATCH_SIZE, BLACKBOX_SAMPLE_MS, initialTransfer, type BlackboxBatch, type BlackboxRecord, type BlackboxTransfer} from "./types";

// Explicit whitelist: never spread a Telemetry/session/agent object onto the wire.
export function blackboxRecord(t: Telemetry): BlackboxRecord {
  if(!t.connected || !Number.isFinite(Date.parse(t.capturedAt)))throw new Error("Chưa có gói blackbox mới hợp lệ.");
  const raw=t.operatingSource==="excel-range";
  const record: BlackboxRecord={
    capturedAt:t.capturedAt,rpm:t.rpm,map:t.map??null,tps:t.tps??null,engineLoad:t.engineLoad??null,
    consumption:t.consumption??null,speed:t.speed,coolant:t.coolant,oil:t.oil,intake:t.intake,
    battery:t.battery,fuel:t.fuel,fan:t.fan,fault:t.fault??null,dtc:[...t.dtc],
    location:{lat:t.location.lat,lon:t.location.lon},
    units:{rpm:"rpm",map:raw?"raw":"kPa",tps:raw?"raw":"%",speed:raw?"raw":"km/h",engineLoad:"%",consumption:"L/h",temperature:"°C",battery:"V",fuel:"%",fan:"%"},
  };
  if(Object.values(record).some(v=>typeof v==="number" && !Number.isFinite(v)) || !Number.isFinite(record.location.lat) || !Number.isFinite(record.location.lon))throw new Error("Gói blackbox có giá trị không hợp lệ.");
  return record;
}

export class BlackboxBatchStream {
  private records: BlackboxRecord[]=[];
  private active=false;
  private target=BLACKBOX_BATCH_SIZE;
  private state=initialTransfer();
  constructor(private vehicleId: string, private changed: (state: BlackboxTransfer)=>void) {}
  start(){this.active=true;this.records=[];this.target=BLACKBOX_BATCH_SIZE;this.state=initialTransfer();this.publish();}
  private publish(){this.state={...this.state,buffered:this.records.length,target:this.target};this.changed(this.state);}
  // Only the one-second timer calls push. UI previews/commands do not count.
  push(t: Telemetry){
    if(!this.active || !t.connected || t.vehicleId!==this.vehicleId)return;
    let record: BlackboxRecord;
    try{record=blackboxRecord(t);}catch{this.records=[];this.publish();return;}
    const previous=this.records.at(-1);
    if(previous){
      const elapsed=Date.parse(record.capturedAt)-Date.parse(previous.capturedAt);
      if(elapsed<BLACKBOX_SAMPLE_MS*0.8)return;
      // Do not fabricate readings after suspension/disconnection.
      if(elapsed>BLACKBOX_SAMPLE_MS*2)this.records=[];
    }
    this.records.push(record);
    if(this.records.length>=this.target){
      const batch: BlackboxBatch={schemaVersion:1,batchId:crypto.randomUUID(),vehicleId:this.vehicleId,source:"simulated",sampleIntervalMs:BLACKBOX_SAMPLE_MS,recordCount:this.records.length,records:this.records};
      this.records=[];this.target=BLACKBOX_BATCH_SIZE;this.state={...this.state,lastBatch:batch};
    }
    this.publish();
  }
  // A new sequence may close its first batch early; later batches are full size.
  breakSequence(firstBatchSize=BLACKBOX_BATCH_SIZE){this.records=[];this.target=Math.min(BLACKBOX_BATCH_SIZE,Math.max(1,firstBatchSize));this.publish();}
  dispose(){this.active=false;this.records=[];}
}
