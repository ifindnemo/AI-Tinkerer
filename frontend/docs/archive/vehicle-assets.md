# Vehicle assets — verified 2026-09-11

The garage has 7 entries: the existing local BMW and 6 official Sketchfab embeds. A public viewer is not a local GLB. Do not infer download rights from embedding availability.

| Asset | Author | Asset license / availability | Delivery |
|---|---|---|---|
| BMW M2 Coupé 2023 | Outlaw Games™ | CC BY-NC 4.0 | Local GLB; see public/models/ATTRIBUTION.md |
| [VinFast VF3 2025](https://sketchfab.com/3d-models/vinfast-vf3-2025-d2f091c453d6427a8ae58c936c44db6f) | Ardhi3D | No downloadable license provided; embed only | Official Sketchfab iframe |
| [Vinfast VF9 model (no interior)](https://sketchfab.com/3d-models/vinfast-vf9-model-no-interior-cac6cb95b9084d0abee37dccb46fa10b) | Giang Trần | CC Attribution | Official Sketchfab iframe |
| [2025 Honda Civic RS e:HEV](https://sketchfab.com/3d-models/2025-honda-civic-rs-ehev-0dc6454d74a241e5a08fac82ce2826b2) | Palma123 JAAT | CC Attribution | Official Sketchfab iframe |
| [2025 Honda CR-V 1.5 VTEC Turbo CVT](https://sketchfab.com/3d-models/2025-honda-cr-v-15-vtec-turbo-cvt-91c6673859444597bf006a0ef8570005) | Palma123 JAAT | CC Attribution | Official Sketchfab iframe |
| [2026 Honda Prelude](https://sketchfab.com/3d-models/2026-honda-prelude-cb119f8c032745a3875da2f4babeae6c) | ImperialBlue3D | No downloadable license provided; embed only | Official Sketchfab iframe |
| [2025 Hyundai Kona N Line](https://sketchfab.com/3d-models/2025-hyundai-kona-n-line-26c27a6e061d4776b750e483b933df79) | Ddiaz Design | CC Attribution-NonCommercial-ShareAlike | Official Sketchfab iframe |

## Important distinctions

- Model years follow asset titles, not upload dates. VF9 has no verified model year, so its year is null in the catalog.
- The 2026 Prelude is a low-poly interpretation by ImperialBlue3D; the artist states it was based on limited reference photos. This is not an OEM CAD model. Honda confirms the 2026 Prelude hybrid at https://automobiles.honda.com/2026/prelude .
- VF3 and Prelude were not downloadable according to the public Sketchfab API. No files were extracted from their viewers.
- VF9, Civic, CR-V and Kona are marked downloadable, but the official download API requires authentication (HTTP 401 without a token). This application uses their supported public embeds, not an unauthenticated workaround.
- Embedded models, author thumbnails, and the viewer SDK require network access. Only the selected remote model iframe is mounted. BMW and UI fonts remain local.
- Paint selection and custom coolant hotspot apply to the local model. Hosted viewers retain native orbit, zoom, fullscreen, branding and author attribution.
- `viewerready` from the official SDK is used to mark readiness. A 30-second notice and retry/source link handle delayed or unavailable hosting; an iframe load event alone is not considered success.
- Per-asset license metadata is recorded in vehicle-sources.json from the public /v3/models endpoint. A creator-provided license is not independent verification of all underlying manufacturer/game asset rights.

## Adding a locally licensed model

Edit src/lib/vehicles.ts. Change the entry model to `{ kind: "local", url: "/models/your-car.glb" }` after obtaining the GLB through an authorized source. Review material naming, scale/orientation, hotspots, provenance, and license. Do not reuse the BMW file under another car name.
