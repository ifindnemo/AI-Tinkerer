# Operating telemetry from filtered Excel ranges

The user requested a realtime-style stream based on `EngineFaultDB_Final.xlsx` and explicitly chose to filter abnormal values rather than display the full raw ranges. The dashboard section is now **Thông số vận hành**. It displays six operating channels with rolling charts for the selected vehicle; it does not browse workbook rows, identify workbook vehicles or show class totals.

## Reproducible profile

Run `python3 scripts/build-telemetry-profile.py /path/to/EngineFaultDB_Final.xlsx`. The standard-library importer writes `src/data/telemetry-profile.json` with the source SHA-256, raw ranges, selected demo filters, retained counts, excluded date-cell counts and output bounds. Numeric strings are parsed as numbers. Date-formatted cells (including this workbook's custom date formats), nonnumeric/nonfinite entries and values outside the configured demo bands are excluded. No decimal repair, date reversal or scale conversion is attempted.

These bands are explicitly authored demo filters, not manufacturer safety limits or verified physical units. Filtering leaves an illustrative subset; it does not prove the source is correctly calibrated. P05 and P95 are selected at the nearest index `round((n - 1) * q)` of each sorted retained column. No full spreadsheet is required at runtime.

| Channel | Demo filter | Retained values | Simulation reference P05–P95 | Display unit |
| --- | --- | ---: | --- | --- |
| RPM | 600–6,500 | 4,475 | 1,176.13–4,536.86 | rpm (column label) |
| MAP | 0–100 | 3,791 | 1.37–3.59 | raw; unverified |
| TPS | 0–100 | 3,719 | 0.81–1.94 | raw; unverified |
| Consumption L/H | 0–30 | 4,485 | 2.46–9.59 | L/h (column label) |
| Speed | 0–130 | 5,380 | 25.72–98.72 | raw; unverified |

MAP/TPS/Speed lack explicit units in their workbook column names. The frontend does not silently assign kPa, percent or km/h to these raw references. Their values and units stay consistent across the dashboard, blackbox table, agent motion line and exported telemetry. Dataset labels are not used to invent fault severity or temperature measurements.

## Stream behavior

`src/lib/telemetry-profile.ts` generates smooth, bounded values using a shared synthetic driving signal. This is neither a replay of workbook rows nor a fitted correlation model. RPM is rounded for display. Samples advance every second through the existing vehicle session adapter, retaining up to 30 chart samples. On reload, the persisted tick resumes the sequence; offline freezes the last timestamp and hides readings/charts until reconnection.

Normal and hot-weather combustion/hybrid scenarios use this range source (`operatingSource: excel-range`). Engine load is an authored relationship to the synthetic signal. Coolant/oil/ambient temperatures, battery voltage, fuel level, fan, DTC and GPS remain separate authored mocks because the workbook does not provide those channels.

The overheating Safety Agent scenario uses `operatingSource: scenario`, with its own coherent moving → slowing → stopped → cooling inputs and explicitly authored physical units. Its intervention states, consent payloads and zero RPM at a stop take priority over the driving reference ranges. The source label and per-channel hints change accordingly. EVs do not use combustion workbook ranges.

The UI identifies the range simulation as **Chưa hiệu chuẩn**, explains raw units in expandable source details, and distinguishes workbook-derived channels from authored channels. These ranges are not used as diagnostic thresholds; mock temperature rules and future authoritative backend risk evaluation remain separate.

Validation includes a one-hour synthetic sequence within bounds, continuity checks, unit/source checks, per-vehicle identity, scenario classification and existing session/incident tests. Browser coverage checks the renamed section, all six charts, range-constrained values, raw labels, stream changes, offline behavior, booking continuity, mobile layout and the full Safety Agent flow.
