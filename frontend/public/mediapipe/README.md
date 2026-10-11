# Vendored MediaPipe assets

Served locally so the driver-attention page never loads code or models from a CDN.

- `wasm/`: copied from the npm package `@mediapipe/tasks-vision` 0.10.21 (`node_modules/@mediapipe/tasks-vision/wasm`), Apache-2.0.
- `face_landmarker.task`: downloaded on 2026-10-11 from
  `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`.
  Check the MediaPipe Face Landmarker model card for its license before a commercial release.

Update both together when upgrading `@mediapipe/tasks-vision`.
