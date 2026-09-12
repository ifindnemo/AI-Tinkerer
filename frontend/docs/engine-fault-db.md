> Current update: filtered column ranges now inform the single-vehicle simulated stream; see [range simulation](telemetry-range-simulation.md). The browsing implementation described below remains historical.

> Historical implementation notes. The user clarified that Excel is a schema example only. Dataset browsing has been removed from the product; see [current dashboard](live-vehicle-dashboard.md).

# EngineFaultDB dashboard

Source: user-provided `EngineFaultDB_Final.xlsx`, sheet `EngineFaultDB_Final`. Imported by `scripts/import-engine-fault-db.py` with Python standard library only. The JSON includes the source SHA-256, all column ranges, class counts, and the first three raw rows per class; it does not bundle the full spreadsheet.

## Confirmed mapping

The user confirmed on 2026-09-12:

| Fault | Meaning | Rows |
|---|---|---:|
| 0 | No fault | 16,000 |
| 1 | Fault present; exact type unknown | 10,998 |
| 2 | Fault present; exact type unknown | 15,000 |
| 3 | Fault present; exact type unknown | 14,001 |

Total: 55,999 rows, with 39,999 fault-labelled rows. These are records, not a count of distinct vehicles. Classification displayed here reads supplied labels; it is not an AI prediction or sensor-based diagnosis. No health score or diagnostic probability is derived from these labels. The internal `watch` value only opens the inspection workflow, not a clinical/manufacturer fault severity rating.

The spreadsheet contains MAP, TPS, Force, Power, RPM, Consumption L/H, Consumption L/100KM, Speed, CO, HC, CO2, O2, Lambda, AFR and Fault. Units/scaling are not fully documented. Raw RPM reaches 5,013,402. Values are retained exactly; no decimal correction is guessed. Temperature, fan state, DTC, timestamps, GPS and vehicle IDs are absent. The file therefore cannot establish overheating or identify a failed component. Sample records are labelled as an unidentified dataset vehicle, not assigned to the BMW model.

## Current frontend behavior

- Overview keeps the local 3D BMW and existing multi-signal overheating demo, with a health summary and inspection recommendation after analysis.
- “Xem dashboard Excel” / “Dữ liệu blackbox” shows class counts, selected label assessment and inspectable raw samples.
- A no-fault label does not trigger a repair booking. Fault labels 1–3 suggest general diagnosis, without naming a failed component.
- Garage suggestions use an explicitly fictional fixed list and specialty matching, not real map distances or availability.
- Flow: user opts to view garages → chooses garage/date/time → reviews → explicitly confirms a local demo appointment. No external request is sent.
- Appointments persist in localStorage, can be cancelled, and prevent duplicate active appointments for the same vehicle/cause. Storage failures show an error and do not claim success. Changing scenario or dataset sample resets unconfirmed selections.
- Browser-local persistence is implemented; real AI, live sensor feeds, garage search/booking API and backend persistence remain backend integration work. The team target remains real downstream processing once connected.

## Integration points

`src/lib/dataset-assessment.ts`: confirmed label mapping only. Replace/extend with verified backend diagnostic results; do not treat `Fault` as an input feature for a classifier that predicts Fault.

`src/lib/service-booking.ts`: validation, record schema and duplicate handling. `src/components/service-planner.tsx`: local storage adapter and consent flow. Replace storage with an authenticated API and distinguish pending request from garage-confirmed status when implementing real bookings.

Run `npm test` and `BASE_URL=http://localhost:3001 node scripts/verify-service-dashboard.mjs` against a built, running app.
