export const BLACKBOX_SAMPLE_MS = 1000;
export const BLACKBOX_BATCH_SIZE = 15;
// After a scenario change (e.g. Inject Overheating) the first batch is sent early
// so the agent reacts within seconds instead of waiting for a full 15-sample batch.
export const BLACKBOX_EARLY_BATCH_SIZE = 5;
export type BlackboxRecord = {
  capturedAt: string;
  rpm: number; map: number | null; tps: number | null; engineLoad: number | null;
  consumption: number | null; speed: number; coolant: number; oil: number;
  intake: number; battery: number; fuel: number; fan: number;
  fault: 0 | 1 | 2 | 3 | null; dtc: string[];
  location: {lat: number; lon: number};
  units: {rpm: "rpm"; map: "raw" | "kPa"; tps: "raw" | "%"; speed: "raw" | "km/h"; engineLoad: "%"; consumption: "L/h"; temperature: "°C"; battery: "V"; fuel: "%"; fan: "%"};
};
export type BlackboxBatch = {
  schemaVersion: 1; batchId: string; vehicleId: string; source: "simulated";
  sampleIntervalMs: 1000; recordCount: number; records: BlackboxRecord[];
};
// `target` is the size of the batch currently being collected (early or full).
export type BlackboxTransfer = {buffered: number; target: number; lastBatch: BlackboxBatch | null};
export const initialTransfer = (): BlackboxTransfer => ({buffered:0,target:BLACKBOX_BATCH_SIZE,lastBatch:null});
