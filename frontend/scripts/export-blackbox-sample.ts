import {writeFile} from "node:fs/promises";
import {BlackboxBatchStream} from "../src/lib/blackbox/batch-stream";
import type {BlackboxBatch} from "../src/lib/blackbox/types";
import {liveSample} from "../src/lib/live-telemetry";

async function main(){
  let batch: BlackboxBatch | null=null;
  const stream=new BlackboxBatchStream("bmw-m2",snapshot=>{batch=snapshot.lastBatch;});
  const start=Math.floor(Date.now()/1000)*1000-15000;
  stream.start();
  for(let second=1;second<=15;second++)stream.push(liveSample("normal","bmw-m2",second,new Date(start+second*1000)));
  stream.dispose();
  if(!batch)throw new Error("Expected a complete 15-record blackbox batch.");
  await writeFile(new URL("../docs/blackbox-batch-15-samples.json",import.meta.url),JSON.stringify(batch,null,2)+"\n");
  console.log("Exported docs/blackbox-batch-15-samples.json: 15 blackbox records, one second apart, no agent data.");
}
void main();
