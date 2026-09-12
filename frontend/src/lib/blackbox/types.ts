export const BLACKBOX_SAMPLE_MS = 1000;
export const BLACKBOX_BATCH_SIZE = 15;
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
  sampleIntervalMs: 1000; recordCount: 15; records: BlackboxRecord[];
};
export type BlackboxTransfer = {buffered: number; lastBatch: BlackboxBatch | null};
export const initialTransfer = (): BlackboxTransfer => ({buffered:0,lastBatch:null});
