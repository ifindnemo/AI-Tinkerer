# Kế hoạch demo Car Neuron — Chủ nhật 18/10/2026

Lập ngày 04/10/2026. Người làm: bạn (cả FE lẫn BE) cùng Claude. Hai bạn BE tham gia sau.

Mục tiêu: trước CEO, Car Neuron chạy như một sản phẩm thật. Thiết bị cắm cổng OBD, dữ liệu xe lên dashboard, agent giải thích lỗi và đặt lịch garage kèm hồ sơ xe. Khi mạng hoặc xe gặp sự cố, chuyển sang chế độ phát lại an toàn.

Thời gian: 13 ngày làm việc (T2 5/10 → T7 17/10), làm tuần tự vì chỉ có một người code.

**Tiến độ (cập nhật 4/10 tối):** đã xong hạng mục A, B, C, D. Kiểm tra: backend 59 test, gateway 49 test, frontend 70 test, ESLint, `tsc`, `next build`; chạy thật gateway → `/api/ingest` của Next → backend (chế độ `AGENT_MODE=rules`) → SSE → dashboard ở chế độ OBD, chụp màn hình ở các mốc bình thường / ≥105°C / P0217 và kịch bản bỏ máy trên hồ sơ xe tối thiểu. Gateway gửi lô 5 mẫu (`--batch-size`) để dashboard gần như trực tiếp. Chưa chạy với OpenAI thật cho chế độ thiết bị (để tránh tốn phí khi chưa hỏi bạn).

**Ký hiệu chủ việc**

| Ký hiệu | Ai làm | Gồm những việc gì |
|---|---|---|
| **[Code]** | Claude làm, bạn review | Viết code |
| **[Bạn]** | Chỉ bạn làm được | Việc cần có mặt hoặc có tài khoản: xe, Google Cloud Console, tunnel/staging, mua thiết bị, kiểm tra sóng tại địa điểm |

---

## 1. Đầu vào cần có, kèm hạn chót

| # | Việc **[Bạn]** | Hạn | Nếu trễ hạn |
|---|---|---|---|
| 1 | Báo **loại cục OBD**: tên/model; kết nối USB, Bluetooth thường, BLE hay WiFi | **Hôm nay 4/10** | Gateway chưa chọn được cách kết nối. Loại chỉ có BLE có thể không tạo cổng serial cho python-OBD (cần kiểm tra); khi đó mua thêm ELM327 USB |
| 2 | Nguồn GPS: GPS USB (NMEA), hoặc chấp nhận vị trí cố định có gắn nhãn | 7/10 | Gateway dùng `--fixed-location`. Thời tiết, tìm garage và đặt lịch vẫn chạy, nhưng UI ghi "Vị trí cố định" |
| 3 | **Mượn một xe có cổng OBD-II trong 2–3 giờ.** Mục tiêu CN 11/10, muộn nhất T3 13/10 | 13/10 | Bỏ bước cắm xe live. Toàn bộ demo chạy trên fake-ELM / simulator, mọi chỗ gắn nhãn "Mô phỏng" |
| 4 | Google Cloud: tạo **OAuth client loại Web**; chỉ cần redirect URI `http://localhost:3000/api/integrations/google/callback`, vì bước kết nối Google luôn làm trên laptop (token lưu ở server); thêm tài khoản demo vào test users | 11/10 | Đặt lịch chỉ demo được bằng một sự kiện tạo sẵn |
| 5 | Chốt **ngưỡng cảnh báo nhiệt độ**. Phim và landing nói "lên tiếng ở 105°C", trong khi prompt hiện coi ECT ổn định 80–105°C là bình thường ([prompt.py:36](../backend/agent/prompt.py#L36)) | 8/10 | Mặc định dùng 105°C kéo dài 20 giây cho detector (mục 4.D) |
| 6 | Chọn cách public với **hostname cố định**: tunnel có tên miền cố định hoặc staging (bạn tự dựng; Claude không dựng hạ tầng). `PUBLIC_APP_URL` được ghi thẳng vào mô tả sự kiện lịch, nên sự kiện tạo trước khi chốt URL sẽ chứa link chết | 12/10 | Chỉ demo trên laptop. Link hồ sơ garage không mở được trên điện thoại người khác, và gateway trong xe không gửi dữ liệu về được |
| 7 | Model 3D: thay model (giấy phép CC BY-NC, [vehicles.ts:42](../frontend/src/lib/vehicles.ts#L42)) hay giữ vì demo chỉ có người nội bộ | 14/10 | Giữ model cũ, thêm nhãn "Xe minh họa" |
| 8 | Chuẩn bị bộ đổi nguồn tẩu sạc cho laptop, điện thoại phát 4G; kiểm tra sóng 4G và chỗ đỗ xe tại địa điểm demo | 16/10 | Dùng chế độ phát lại |

---

## 2. Phạm vi

**Làm trước demo** (5 tính năng đã chọn và phần đặt lịch):
1. Tự nhận biết xe khi cắm thiết bị: VIN và danh sách PID; dashboard chỉ hiện cảm biến xe có.
2. Mã lỗi DTC và freeze frame, giải thích bằng tiếng Việt (mức khẩn, garage sẽ kiểm tra gì). Không có nút xóa mã.
3. Hộp đen chuyến đi: bản đồ, biểu đồ, sự kiện ghim theo thời điểm. Đây cũng là chế độ phát lại cho demo.
4. Hỏi xe bằng tiếng Việt.
5. Đặt lịch garage kèm bệnh án xe (sửa lại luồng cũ từng lỗi).

**Không làm trước demo:**
- tài khoản nhiều người dùng, thiết bị 4G, Postgres, CI đầy đủ;
- pháp lý và quyền riêng tư;
- cảnh báo qua Telegram/Zalo;
- màn hình đội xe, sức khỏe ắc quy, nhắc bảo dưỡng theo km.

**Nếu còn thời gian:**
- security headers / CSP trong [next.config.ts](../frontend/next.config.ts);
- các trang `error.tsx` và `not-found.tsx`;
- Prettier cho các file viết dồn một dòng trong `lib/backend/`;
- xóa [service-planner.tsx](../frontend/src/components/service-planner.tsx) (không còn được dùng);
- nén model GLB 17 MB;
- gỡ 4 file `.pyc` mà git đang theo dõi.

---

## 3. Kiến trúc cho demo

```
Xe ─ cục OBD ─ laptop gateway (Python) ──POST /api/ingest──┐
                     │ GPS USB hoặc --fixed-location       │
Simulator / fake-ELM ┘ (cùng gateway, --source sim|fake-elm)│
                                                            ▼
                         Next.js (URL public, mật khẩu demo) ─ proxy ─► FastAPI (127.0.0.1:8000)
                                                                          │ SQLite: xe, chuyến, mẫu, DTC, phân tích
                                                                          │ detector luật → agent (khi có dấu hiệu / 5 phút)
                         Dashboard ◄── SSE ──────────────────────────────┘
```

**Nguyên tắc: chỉ thêm, không thay.**
- **API cũ giữ nguyên.** `POST /api/telemetry/batch` (v1) và [validateBatch](../frontend/src/lib/backend/contract.ts#L16) vẫn chạy như cũ (hàm này bắt buộc `source:'simulated'` và 5–15 mẫu). Ingest v2 là đường mới, không đi qua chúng.
- **Thêm chế độ, không thay chế độ.**
  - Adapter `device` (SSE) là chế độ thứ ba, bên cạnh `backend` và `mock` ([createVehicleSessionAdapter](../frontend/src/lib/vehicle-session/index.ts#L9)).
  - Chỉ đổi chế độ mặc định khi luồng demo đã xanh. Nhờ vậy 62 test và các script Playwright không bị vỡ giữa chừng.
- **Giữ [overheatCoolant](../frontend/src/lib/live-telemetry.ts#L13) và `overheatSecondAt`:** landing và phim đang import hai hàm này.
- **Override `source=="simulated"` giữ tạm.** Chỉ bỏ [phần này](../backend/agent/orchestrator.py#L110) sau khi trần mức độ theo detector (mục 4.D) đã có test. Bỏ sớm hơn thì chế độ mô phỏng sẽ báo sai.
- **Dữ liệu:** SQLite chạy trên laptop, không dựng hạ tầng mới.

### 3.1 Schema ingest v2

Chỉ `capturedAt` là bắt buộc trong mỗi bản ghi; mọi cảm biến đều tùy chọn. Tên tín hiệu lạ sẽ bị trả lỗi 422.

```json
{
  "schemaVersion": 2,
  "batchId": "uuid — chống gửi trùng",
  "deviceId": "dev_laptop01",
  "tripId": "trip_20261011_0815_ab12",
  "seq": 42,
  "source": "obd | fake-elm | sim",
  "sampleIntervalMs": 1000,
  "vehicle": {
    "vin": "null nếu xe không trả",
    "protocol": "ISO 15765-4 (CAN 11/500)",
    "supportedPids": ["0104", "0105", "010C", "010D", "010F", "0142"]
  },
  "records": [
    {
      "capturedAt": "2026-10-11T08:15:01+07:00",
      "location": {"lat": 10.8023, "lon": 106.7311, "accuracyM": 8, "fixed": false},
      "signals": {"rpm": 812, "speed": 0, "engineLoad": 21.5, "coolant": 88}
    }
  ],
  "dtc": {
    "readAt": "2026-10-11T08:15:00+07:00",
    "mil": true,
    "stored": ["P0217"],
    "pending": [],
    "freezeFrame": {"dtc": "P0217", "signals": {"rpm": 2400, "coolant": 121, "engineLoad": 38, "speed": 62}}
  }
}
```

Hai khối `vehicle` và `dtc` là tùy chọn: `vehicle` gửi ở lô đầu mỗi chuyến, `dtc` gửi khi vừa đọc mã.

**Danh sách tín hiệu cho phép**

PID theo Mode 01. Nhịp đọc là đề xuất, cần đo lại trên cục OBD thật:

| Tín hiệu | PID | Đơn vị | Khoảng hợp lệ | Nhịp đọc |
|---|---|---|---|---|
| rpm | 0C | rpm | 0–12000 | 1 s |
| speed | 0D | km/h | 0–300 | 1 s |
| engineLoad | 04 | % | 0–100 | 1 s |
| coolant | 05 | °C | -40–180 | 1 s |
| intake | 0F | °C | -40–100 | 5 s |
| map | 0B | kPa | 0–255 | 5 s |
| maf | 10 | g/s | 0–700 | 5 s |
| tps | 11 | % | 0–100 | 5 s |
| stft1 / ltft1 | 06 / 07 | % | -100–100 | 5 s |
| battery | 42 | V | 0–30 | 5 s |
| oil | 5C | °C | -40–220 | 5 s |
| fuel | 2F | % | 0–100 | 30 s |
| ambient | 46 | °C | -40–80 | 30 s |

Trạng thái quạt không có trong PID chuẩn. Vì vậy với xe thật, kịch bản quá nhiệt dựa vào xu hướng nhiệt độ so với tải máy.

### 3.2 Bảng SQLite mới

Giữ nguyên các bảng cũ: `incidents`, `pending_actions`, `appointments`, `reminders`, `incident_memories`.

| Bảng | Cột chính |
|---|---|
| `devices` | id, token_hash, vehicle_id, label, last_seen_at |
| `vehicles` | id, vin, make, model_year_guess, display_name, protocol, supported_pids_json |
| `trips` | id, vehicle_id, device_id, source, simulated, started_at, ended_at, status, sample_count, distance_km, max_coolant, event_count |
| `ingest_batches` | id (batchId), device_id, trip_id, seq, received_at |
| `samples` | trip_id, captured_at, lat, lon, location_fixed, signals_json — khóa (trip_id, captured_at) |
| `dtc_events` | id, vehicle_id, trip_id, code, kind (stored/pending), mil, first_seen_at, last_seen_at, freeze_frame_json |
| `analyses` | id, vehicle_id, trip_id, at, trigger, model_severity, final_severity, assessment_json, tool_trace_json, incident_id |
| `trip_events` | id, trip_id, at, kind (warning/critical/dtc/guardrail/start/end), title, ref_id |
| `trip_weather` | trip_id, at, lat, lon, outside_temp_c |
| `reports` | token, incident_id, created_at, expires_at |
| `oauth_tokens` | provider, token_json, account_hint, updated_at |

Migration dùng `PRAGMA user_version`, bật chế độ WAL.

### 3.3 API mới và API được sửa

| Method | Đường dẫn (backend) | Ghi chú |
|---|---|---|
| POST | `/api/ingest/batch` | Bearer token theo thiết bị. Trả 202 ngay; phân tích chạy nền |
| GET | `/api/vehicles/{id}/stream` | SSE với các sự kiện `sample`, `profile`, `analysis`, `dtc`, `trip` |
| GET | `/api/vehicles/{id}/profile` | VIN, hãng, năm ước lượng, cảm biến xe có và xe thiếu |
| GET | `/api/vehicles/{id}/trips?from&to` | Danh sách chuyến |
| GET | `/api/trips/{id}` | Tóm tắt, sự kiện ghim, thời tiết |
| GET | `/api/trips/{id}/samples?signals&max_points` | Chuỗi dữ liệu đã rút gọn (tối đa khoảng 600 điểm) |
| GET | `/api/trips/{id}/analyses` | Kết quả agent đã lưu, dùng khi phát lại (không gọi lại LLM) |
| GET | `/api/vehicles/{id}/dtc` | Mã hiện tại và lịch sử, kèm giải thích |
| POST | `/api/vehicles/{id}/ask` | Hỏi xe |
| POST | `/api/incidents/{id}/action` | **Sửa:** kiểm tra garage có nằm trong kết quả tìm kiếm; tạo token bệnh án |
| POST | `/api/incidents/{id}/confirm` | **Sửa:** chiếm quyền nguyên tử, không tạo trùng |
| GET | `/api/actions/{id}` | Mới: trạng thái của hành động |
| GET/POST | `/api/integrations/google/{status,connect,callback}` | OAuth web, thay luồng desktop |
| GET | `/api/reports/{token}` | Dữ liệu bệnh án |

Phía Next:
- Mở rộng danh sách route cho phép trong [route.ts:6](../frontend/src/app/api/vehicle/[...path]/route.ts#L6).
- Thêm route SSE riêng.
- Thêm route `/api/ingest` để gateway gửi qua URL public.

### 3.4 Thư mục mới

```
gateway/                       chạy trên laptop trong xe
  car_neuron_gateway/
    cli.py                     python -m car_neuron_gateway --source obd|fake-elm|sim
    sources/obd_source.py      python-OBD
    sources/fake_elm.py        ELM327 giả qua pty: kịch bản normal / city / overheat / misfire / lean
    sources/simulator.py       chuyển kịch bản quá nhiệt từ live-telemetry.ts sang
    readers.py                 nhóm PID nhanh/chậm, DTC, freeze frame, VIN
    allowlist.py               chỉ cho phép mode 01/02/03/07/09; chặn 04
    gps.py                     NMEA serial hoặc --fixed-location
    trip.py                    tách chuyến theo nổ máy / tắt máy
    uploader.py                gửi lô, thử lại, hàng đợi trên đĩa khi mất mạng
  tests/
  requirements.txt
backend/
  telemetry/   schemas_v2.py  db.py  ingest.py  trips.py  stream.py  vin.py  routes.py
  analysis/    detector.py  worker.py  rules_fallback.py
  dtc/         kb_vi.json  kb.py
  ask/         agent.py  tools.py  routes.py
  booking/     oauth.py  reports.py  routes.py
  scripts/     create_device.py  eval_trips.py
frontend/src/
  lib/device/  device-adapter.ts  replay-adapter.ts  signals.ts
  app/api/vehicle/stream/[id]/route.ts   app/api/ingest/route.ts   app/api/integrations/google/callback/route.ts
  app/trips/page.tsx   app/trips/[id]/page.tsx   app/report/[token]/page.tsx
  components/  vehicle-profile.tsx  dtc-card.tsx  trip-list.tsx  trip-detail.tsx  trip-map.tsx
               trip-charts.tsx  replay-controls.tsx  ask-car.tsx  booking-planner.tsx  google-connect.tsx
  proxy.ts     mật khẩu demo (Next 16 đổi tên middleware thành proxy)
```

---

## 4. Chi tiết từng hạng mục

### A. Nền backend
- [x] **[Code]** Sửa `store.py` (xong 4/10; `user_version` để làm cùng các bảng mới):
  - Đóng kết nối sau mỗi lần dùng ([store.py:23](../backend/store.py#L23)). Khối `with sqlite3.connect()` chỉ commit, không đóng.
  - `initialize()` chỉ chạy một lần lúc khởi động, không chạy ở mọi lời gọi.
  - Bật WAL và dùng `user_version`.
- [x] **[Code]** (xong 4/10, `backend/telemetry/schemas_v2.py`) Viết `schemas_v2.py`: danh sách tín hiệu cho phép theo bảng 3.1; kiểm tra khoảng giá trị và thứ tự thời gian (khoảng cách giữa hai mẫu 0,5–10 s).
- [x] **[Code]** **Mọi mốc thời gian lưu theo UTC.** Lúc ingest, chuẩn hóa `capturedAt` và `readAt` về UTC. (Xong: DB lưu dạng UTC cố định độ dài, ví dụ `2026-10-11T01:15:00.000+00:00`.)
  - SQLite so sánh thời gian như chuỗi ký tự; nếu lẫn `+07:00` với `+00:00` thì truy vấn theo khoảng lệch 7 giờ.
  - Chỉ đổi sang giờ Việt Nam ở UI, và trong tool của agent hỏi xe (đổi "chiều qua" thành một khoảng UTC rồi mới truy vấn).
- [x] **[Code]** Tạo các bảng ở mục 3.2, kèm migration. (Xong các bảng cho ingest: `devices`, `vehicles`, `trips`, `ingest_batches`, `samples`, `dtc_events`, ở `user_version` 1. Các bảng còn lại thêm thành migration sau.)
- [x] **[Code]** Viết `scripts/create_device.py`: in token một lần và chỉ lưu hash.
- [x] **[Code]** Viết `POST /api/ingest/batch` (đã kèm ghi DTC và freeze frame):
  - xác thực Bearer token;
  - chống trùng `batchId`;
  - lưu mẫu, mở chuyến, cập nhật hồ sơ xe;
  - trả 202 ngay.
- [x] **[Code]** Test ingest cho các trường hợp: hợp lệ; trùng lô; sai token; tín hiệu lạ; lô thiếu cảm biến vẫn được nhận.

**Xong khi:** curl một lô v2 thì có chuyến và mẫu trong DB, và 11 test cũ cùng test mới đều xanh.

### B. Gateway
- [x] **[Code]** (xong 4/10) Viết `fake_elm.py`, một ELM327 giả qua pty:
  - Trả lời các lệnh AT khởi tạo, bảng PID hỗ trợ (`0100/0120/0140`), giá trị Mode 01, DTC qua `03`/`07`, VIN qua `0902`, freeze frame qua `02xx`.
  - Có hai hồ sơ xe: "đầy đủ" và "tối thiểu" (không có oil, fuel, ambient), để kiểm tra việc ẩn cảm biến.
  - Có các kịch bản: `normal`, `city`, `overheat` (95 → 105 → 115 → 122°C), `misfire` (P0301 kèm freeze frame), `lean` (P0171, fuel trim cao).
- [x] **[Code]** (xong 4/10: dùng client ELM327 tự viết `elm327.py` + `sources.py` thay python-OBD, để mọi lệnh qua allowlist và đọc được freeze frame) Viết `obd_source.py` dùng python-OBD.
  - Bước đầu tiên là đọc danh sách PID xe hỗ trợ, rồi chỉ đọc các PID có trong danh sách.
  - Freeze frame (Mode 02) và VIN (Mode 09): python-OBD có hỗ trợ đầy đủ không thì **cần kiểm tra**; nếu không, gửi lệnh thô `02xx00` / `0902`.
- [x] **[Code]** (xong 4/10, 21 test) Viết `allowlist.py`: chỉ cho phép mode 01/02/03/07/09 và các lệnh AT khởi tạo; **Mode 04 (xóa mã) bị chặn, có test.**
- [x] **[Code]** (xong 4/10, nằm trong `runner.py` + `sources.py`) Viết `readers.py`:
  - nhóm PID nhanh (1 s) và chậm (5 s, 30 s);
  - DTC đọc 30 s một lần và ngay khi đèn MIL đổi trạng thái (theo `0101`).
- [x] **[Code]** (xong 4/10) Viết `gps.py`: đọc NMEA qua cổng serial; tùy chọn `--fixed-location lat,lon` gắn cờ `fixed: true`.
- [x] **[Code]** (xong 4/10) Viết `trip.py`: rpm > 0 là bắt đầu chuyến; rpm = 0 quá 120 s hoặc mất kết nối là kết thúc.
- [x] **[Code]** (xong 4/10) Viết `uploader.py`: thử lại với thời gian chờ tăng dần; mất mạng thì xếp hàng trên đĩa và gửi lại đúng thứ tự.
- [x] **[Code]** (xong 4/10: `scenarios.py` + `SimSource`) Viết `simulator.py`: chuyển kịch bản quá nhiệt từ frontend sang Python. Chuyến tạo ra mang `source: sim` và nhãn "Mô phỏng".
- [x] **[Code]** (xong 4/10) Viết README cho gateway: cách kết nối USB (`/dev/ttyUSB0`) và Bluetooth thường (`rfcomm` → `/dev/rfcomm0`). WiFi và BLE ghi "cần kiểm tra khi biết loại cục OBD".

**Xong khi:** chạy `--source fake-elm --scenario overheat` trong 2 phút thì DB có 1 chuyến cùng VIN và danh sách PID, và test chặn Mode 04 xanh.

### C. Luồng trực tiếp và tự nhận biết xe
- [x] **[Code]** Viết `stream.py`: pub/sub trong process, an toàn với nhiều thread; `GET /api/vehicles/{id}/stream` gửi heartbeat 15 s một lần. ✅
- [x] **[Code]** Viết `vin.py`: ✅
  - Ký tự 1–3 (WMI) tra bảng các hãng phổ biến ở VN.
  - Ký tự thứ 10 cho năm sản xuất, nhưng mã này lặp lại theo chu kỳ nên chỉ là **ước lượng**.
  - Không khớp hãng nào thì hiện "Chưa xác định", người dùng tự chọn.
- [x] **[Code]** Route SSE trong Next. Đọc hướng dẫn trong `node_modules/next/dist/docs/` trước khi viết. ✅
- [x] **[Code]** Viết `device-adapter.ts`: implement `VehicleSessionAdapter`, thêm `"device"` vào `AgentMode`. ✅ (Làm khác kế hoạch: dùng store SSE riêng `lib/device/stream.ts` + reducer `lib/device/state.ts` thay cho implement `VehicleSessionAdapter`, vì chế độ thiết bị không cần các lệnh mô phỏng của adapter cũ.)
  - Snapshot có thêm tập tín hiệu xe có.
  - Kết quả phân tích được chuyển sang dạng `AgentReply` để dùng lại `BackendAgentPanel`.
- [x] **[Code]** Viết `vehicle-profile.tsx`, thẻ "Đã nhận xe": VIN, hãng, năm ước lượng, số cảm biến (X/Y), cho sửa tên xe. ✅
- [x] **[Code]** Sửa `vehicle-telemetry.tsx`: chỉ hiện thẻ cảm biến xe có; thêm danh sách "Xe không cung cấp"; bỏ các nhãn nguồn kiểu "mock". ✅ (Làm khác kế hoạch: viết component mới `components/live/live-metrics.tsx` thay vì sửa `vehicle-telemetry.tsx`, để dashboard API/Mock cũ giữ nguyên.)
- [x] **[Code]** Chế độ trình diễn (`?presenter=1`): ✅
  - ẩn nút API/Mock ([garage.tsx:186](../frontend/src/components/garage.tsx#L186)) và nút "Mô phỏng quá nhiệt";
  - Shift+D mở bảng chuyển giữa live và phát lại.

- [x] **[Code]** Response SSE đặt `Cache-Control: no-cache, no-transform` để tunnel không giữ lại dữ liệu. ✅

**Xong khi:** chạy gateway fake-elm với hồ sơ "tối thiểu", `/garage` ở chế độ device hiện đúng xe và đúng bộ cảm biến trong vòng 10 giây; chế độ backend và mock cũ vẫn chạy.

### D. Detector, phân tích và DTC
- [x] **[Code]** Viết `detector.py`, các luật là **đề xuất**, chốt ngày 8/10: ✅ (Đã dùng mặc định 105°C/20 s; bạn vẫn có thể chốt lại.)

  | Luật | Điều kiện | Mức tối thiểu |
  |---|---|---|
  | R1 | coolant ≥ 105°C liên tục 20 s | warning |
  | R2 | coolant > 95°C và tăng > 3°C/phút trong 60 s, tải không tăng quá 5 điểm % | gọi agent |
  | R3 | Có DTC mới hoặc đèn MIL bật | gọi agent |
  | R4 | battery < 12,0 V khi rpm > 500, hoặc > 15,2 V, kéo dài 30 s | gọi agent |
  | R5 | coolant đứng yên một giá trị 10 phút trong khi xe chạy | ghi "nghi cảm biến" |

  Agent cũng được gọi **ngay khi nhận lô đầy đủ đầu tiên của mỗi chuyến** và khi hồ sơ xe thay đổi. Như vậy vừa cắm thiết bị là có nhận định, không phải chờ nhịp 5 phút. Sau đó, không luật nào kích hoạt thì cứ 5 phút gọi agent một lần.
- [x] **[Code]** Viết `worker.py`: ✅
  - hàng đợi theo xe, gộp các yêu cầu trùng;
  - chuyển `Runner.run_sync` ([orchestrator.py:92](../backend/agent/orchestrator.py#L92)) sang `Runner.run` (async) với timeout 45 s;
  - đẩy kết quả qua SSE.
- [x] **[Code]** **Trần mức độ dựa trên detector:** ✅
  - Không có luật nào, guardrail không kích hoạt và không có DTC thì mức cuối cùng là `normal`.
  - Vẫn lưu `model_severity` gốc để sau này đếm số lần báo sai.
  - Chỉ bỏ override theo `source` sau khi phần này đã có test.
- [x] **[Code]** Viết `rules_fallback.py`: OpenAI lỗi hoặc hết thời gian thì trả đánh giá theo luật, gắn nhãn "Đánh giá theo luật (agent chưa phản hồi)". ✅ (Tên file thực tế: `analysis/rules.py`; bật bằng `AGENT_MODE=rules`.)
- [x] **[Code]** Mở rộng guardrail ([safety.py:15](../backend/agent/safety.py#L15)): P0217 đặt mức tối thiểu critical; P0300–P0308 đặt mức tối thiểu warning. ✅
- [x] **[Code]** Viết `dtc/kb_vi.json`, khoảng 60–100 mã P0xxx phổ biến. ✅ (Thực tế: `backend/dtc/kb.py`, 84 mã; họ bỏ máy và cảm biến oxy sinh từ mẫu.)
  - Các nhóm: làm mát (P0115–P0119, P0125, P0128, P0217), bỏ máy (P0300–P0308), hỗn hợp (P0171/P0172/P0174/P0175), MAF/MAP (P0100–P0108), O2 (P0130–P0141), xúc tác (P0420/P0430), EVAP (P0440–P0456), bướm ga (P0120–P0123), cầm chừng (P0505–P0507), tốc độ xe (P0500), điện áp (P0560–P0563).
  - Mỗi mã có: tiêu đề, hệ thống, mức khẩn mặc định, ý nghĩa, nguyên nhân thường gặp, việc garage sẽ kiểm tra, lời khuyên cho tài xế.
- [x] **[Code]** Cập nhật prompt để agent nhận thêm: tín hiệu xe có và xe thiếu, DTC kèm freeze frame, mục tương ứng trong kho mã lỗi. ✅
  - Mã ngoài kho hoặc mã riêng của hãng (P1xxx): trả lời "cần máy chẩn đoán của hãng", không đoán.
- [x] **[Code]** Viết `dtc-card.tsx`: mã, tên tiếng Việt, trạng thái lưu/chờ, mức khẩn, bảng freeze frame, mục "Garage sẽ kiểm tra"; **không có nút xóa**. ✅

**Xong khi:**
- vừa cắm thiết bị (fake-elm) thì trong khoảng 60 giây đã có nhận định đầu tiên;
- fake-elm kịch bản `overheat`: có cảnh báo ở ≥ 105°C, trước khi chạm 120°C;
- kịch bản `normal` chạy 10 phút: không có cảnh báo nào;
- kịch bản `misfire`: thẻ DTC hiện đủ các phần trong 30 giây.

### E. Hộp đen chuyến đi và phát lại
- [ ] **[Code]** Viết `trips.py`:
  - Backend tự đóng chuyến nếu 5 phút không có dữ liệu.
  - Tóm tắt chuyến: thời lượng, số km (tính từ tốc độ), nhiệt độ cao nhất, số sự kiện.
  - Rút gọn chuỗi dữ liệu theo nhóm min/max, tối đa khoảng 600 điểm.
- [ ] **[Code]** `trip_events` được tạo khi: bắt đầu hoặc kết thúc chuyến, có cảnh báo, có DTC mới, guardrail kích hoạt. (Một phần đã xong 4/10: ghim bắt đầu chuyến, mã lỗi mới, và khi mức độ phân tích thay đổi.)
- [ ] **[Code]** Thời tiết theo chuyến: lấy ở đầu chuyến rồi 30 phút một lần; tool môi trường dùng lại kết quả nếu chưa quá 15 phút.
- [ ] **[Code]** Trang `/trips`: danh sách chuyến; chuyến mô phỏng có nhãn "Mô phỏng".
- [ ] **[Code]** Trang `/trips/[id]`:
  - biểu đồ SVG 4 làn (nhiệt, RPM, tốc độ, tải) kèm ghim sự kiện;
  - thanh kéo thời gian và deep link `?t=`;
  - bản đồ Leaflet với tile OpenStreetMap, có ghi nguồn. Chỉ hợp với lưu lượng nhỏ của demo; **cần kiểm tra chính sách sử dụng tile**. Thêm thư viện `leaflet`.
- [ ] **[Code]** Viết `replay-adapter.ts`: phát lại một chuyến qua dashboard ở 1×/4×/16×.
  - Kết quả agent lấy từ `analyses` đã lưu, nên **khi phát lại không gọi LLM**.

**Xong khi:** mở một chuyến, kéo thời gian thì điểm trên bản đồ khớp biểu đồ, và phát lại chuyến quá nhiệt trên dashboard khi đã tắt mạng tới OpenAI.

### F. Đặt lịch và bệnh án xe
Luồng cũ (bị gỡ ở commit `a3255a0`) lỗi vì:
- **Đã xác minh:** gặp bất kỳ lỗi nào khi xác nhận, frontend chuyển sang trạng thái "không chắc chắn" và khóa vĩnh viễn; backend lại không có API nào để hỏi trạng thái.
- **Khả năng cao:** chưa có `token.json`, nên lần xác nhận đầu tiên chạy luồng đăng nhập Google kiểu desktop ngay trong request ([google_calendar.py:59](../backend/agent/tools/google_calendar.py#L59)).

Việc cần làm:
- [ ] **[Code]** Viết `booking/oauth.py`: luồng OAuth web (client loại Web, có tham số `state`), lưu token vào `oauth_tokens`.
  - `_get_credentials` không bao giờ chạy `run_local_server` nữa.
  - Chưa kết nối Google thì trả 409 "Chưa kết nối Google Calendar".
  - Bỏ việc tìm `client_secret` sai thư mục ([google_calendar.py:34](../backend/agent/tools/google_calendar.py#L34)).
- [ ] **[Code]** Sửa `prepare_action` ([orchestrator.py:295](../backend/agent/orchestrator.py#L295)):
  - `garage_id` phải nằm trong kết quả `search_nearby_garages` của chính sự cố đó;
  - lưu sẵn tên, địa chỉ, tọa độ garage vào payload;
  - tạo token bệnh án.
- [ ] **[Code]** Sửa `confirm_action` ([orchestrator.py:319](../backend/agent/orchestrator.py#L319)):
  - Chiếm quyền bằng `UPDATE … SET status='executing' WHERE id=? AND status='pending_confirmation'`; không đổi được dòng nào thì trả 409.
  - Lỗi khi tạo lịch thì chuyển sang trạng thái `failed` và cho phép thử lại.
  - Event ID suy ra từ ID của hành động để không tạo trùng. Calendar API có nhận ID do client đặt không thì **cần kiểm tra**.
- [ ] **[Code]** Viết `GET /api/actions/{id}`.
- [ ] **[Code]** Sửa nội dung sự kiện lịch:
  - Địa điểm là "Tên garage, địa chỉ", thay cho `place_id` ([orchestrator.py:339](../backend/agent/orchestrator.py#L339)).
  - Phần mô tả có tóm tắt và link `PUBLIC_APP_URL/report/{token}`.
- [ ] **[Code]** Nhắc nhở vẫn chỉ lưu vào DB. UI ghi rõ "Đã lưu, chưa gửi thông báo".
- [ ] **[Code]** Viết `booking-planner.tsx` với các trạng thái: chuẩn bị → xem lại → đang xác nhận → xong | lỗi (thử lại) | chưa rõ.
  - Khi chưa rõ thì hỏi `GET /actions/{id}`; **không bao giờ khóa vĩnh viễn**.
- [ ] **[Code]** Viết `google-connect.tsx`: hiện trạng thái kết nối và nút "Kết nối Google Calendar".
- [ ] **[Code]** Trang `/report/[token]`:
  - Nội dung: xe (VIN/hãng/năm), triệu chứng theo thời gian, biểu đồ đoạn liên quan, DTC và freeze frame, nhận định của agent kèm độ tin cậy, việc garage nên kiểm tra.
  - Có dòng "Car Neuron hỗ trợ, không thay thế chẩn đoán của kỹ thuật viên".
  - Không đưa lộ trình GPS. Token hết hạn sau 14 ngày.
  - Có CSS in khổ A4 để xuất PDF.
- [ ] **[Code]** Test: bấm xác nhận hai lần cùng lúc chỉ tạo một sự kiện; garage không có trong kết quả tìm kiếm thì trả 400; lỗi khi tạo lịch thì thử lại được.

**Xong khi:** từ một sự cố chọn garage và giờ, xác nhận xong có sự kiện lịch chứa link bệnh án, link mở được trên điện thoại khác, và bấm xác nhận hai lần không tạo trùng.

### G. Hỏi xe bằng tiếng Việt
- [ ] **[Code]** Viết `ask/agent.py`: một agent riêng **chỉ có tool đọc**, timeout 45 s.
  - Đầu ra có cấu trúc `{answer, citations[{trip_id, at, label}], used_simulated_data}`.
- [ ] **[Code]** Viết `ask/tools.py` với các tool: `list_trips(start, end)`, `get_trip_summary`, `get_signal_series(trip_id, signals, start?, end?, max_points=120)`, `list_events`, `get_dtc_history`, `get_maintenance_history`, `get_trip_weather`.
- [ ] **[Code]** Prompt cho agent hỏi xe:
  - Cho biết giờ hiện tại theo múi Asia/Ho_Chi_Minh, và quy ước các buổi: sáng 6–12h, chiều 12–18h, tối 18–23h.
  - Câu trả lời phải dẫn số liệu và chuyến cụ thể.
  - Không có dữ liệu thì nói không có; dữ liệu mô phỏng thì phải nói là mô phỏng.
- [ ] **[Code]** Viết `ask-car.tsx`: khung chat với các câu gợi ý; mỗi trích dẫn là nút dẫn tới `/trips/{id}?t=`.
- [ ] **[Code]** Giới hạn 10 câu hỏi mỗi phút.

5 câu kiểm tra, câu trả lời phải đúng với số liệu kiểm tra tay:
1. "Vì sao chiều qua xe nóng?" (hoặc "Chiều 17/10 xe có nóng bất thường không?")
2. "Hôm nay xe có lỗi gì không?"
3. "Tuần này nhiệt độ nước làm mát cao nhất bao nhiêu, lúc nào?"
4. "Mã P0217 nghĩa là gì, có nguy hiểm không?"
5. "Lần bảo dưỡng gần nhất là khi nào?"

### H. Chuẩn bị demo
- [ ] **[Code]** Viết `src/proxy.ts` (Next 16): Basic Auth bằng `DEMO_PASSCODE`. Miễn cho:
  - `/report/*` và `/api/reports/*` (đã có token);
  - `/api/ingest` (đã có token thiết bị);
  - **các file tĩnh mà trang bệnh án cần:** `/_next/static/*`, `/_next/image`, `/fonts/*`, `/brand/*`. Thiếu phần này thì điện thoại mở link bệnh án sẽ bị hỏi mật khẩu hoặc trang hiển thị lỗi.
- [ ] **[Code]** Sửa [sameOrigin](../frontend/src/lib/backend/proxy.ts#L6): yêu cầu POST phải có Origin hoặc `Sec-Fetch-Site: same-origin`, vì hiện thiếu header Origin là được cho qua.
  - **Không** áp kiểm tra này cho `/api/ingest` (gateway không gửi Origin, đã xác thực bằng token) và callback Google (là điều hướng từ trang khác về).
- [ ] **[Code]** Backend chỉ lắng nghe `127.0.0.1`; cập nhật `dev.sh` để chạy kèm gateway sim.
- [ ] **[Code]** Viết `scripts/eval_trips.py`:
  - chạy lại các chuyến đã ghi qua detector và agent, theo từng cửa sổ 15 s;
  - in bảng gồm cửa sổ, luật kích hoạt, `model_severity`, `final_severity`.
  - Mục tiêu: chuyến bình thường không có cảnh báo nào; chuyến quá nhiệt có cảnh báo khi ≥ 105°C.
- [ ] **[Code]** Cập nhật lời giới thiệu trên landing cho khớp đường dữ liệu OBD thật, kèm nhãn mô phỏng.
- [ ] **[Code]** Cập nhật README và viết `docs/demo-runbook.md`: các lệnh khởi động, cách chuyển sang dự phòng.
- [ ] **[Bạn]** Kết nối Google Calendar trước buổi demo. App chưa được Google xác minh sẽ hiện cảnh báo; refresh token ở trạng thái Testing có thể hết hạn sau 7 ngày (**cần kiểm tra**). Vì vậy cần kết nối lại vào 16/10.

---

## 5. Lịch theo ngày

| Ngày | Việc | Xong khi |
|---|---|---|
| **CN 4/10** (tối nay) | [Bạn] mục 1: loại cục OBD, GPS, hẹn ngày mượn xe | Biết cách gateway kết nối với cục OBD |
| **T2 5/10** | Hạng mục A: nền backend | curl lô v2 thì có chuyến trong DB; test xanh |
| **T3 6/10** | Hạng mục B: gateway và fake-ELM | fake-elm overheat tạo được chuyến kèm VIN và PID; test chặn Mode 04 xanh |
| **T4 7/10** | Hạng mục C: SSE, adapter device, thẻ hồ sơ xe, ẩn cảm biến, chế độ trình diễn | `/garage` chạy theo dữ liệu từ gateway; chế độ cũ vẫn chạy |
| **T5 8/10** | Hạng mục D (phần 1): detector, worker, trần mức độ, đánh giá theo luật · [Bạn] chốt ngưỡng 105°C | overheat cảnh báo trước 120°C; normal 10 phút không có cảnh báo |
| **T6 9/10** | Hạng mục D (phần 2): kho DTC, guardrail DTC, prompt, thẻ DTC | Kịch bản misfire hiện thẻ DTC đầy đủ |
| **T7 10/10** | Hạng mục E (phần 1): backend chuyến đi, trang `/trips`, chi tiết chuyến (biểu đồ, ghim) | Xem lại một chuyến fake-elm kèm sự kiện |
| **CN 11/10** | Hạng mục E (phần 2): bản đồ, thanh thời gian, phát lại, thời tiết theo chuyến · **[Bạn] ngày xe (mục tiêu)** | Phát lại chạy khi không có OpenAI; nếu có xe: ít nhất 3 chuyến thật trong DB |
| **T2 12/10** | Hạng mục F (phần 1): OAuth web, claim, API trạng thái, kiểm tra garage, backend bệnh án · [Bạn] chốt URL public cố định | Test xác nhận đồng thời xanh |
| **T3 13/10** | Hạng mục F (phần 2): giao diện đặt lịch, trang `/report`, in PDF · **hạn chót ngày xe** | Đặt lịch chạy trọn luồng; link mở trên điện thoại |
| **T4 14/10** | Hạng mục G: hỏi xe · **đóng băng tính năng cuối ngày** · [Bạn] chốt model 3D | 5 câu kiểm tra trả lời đúng |
| **T5 15/10** | Hạng mục H: chạy eval và chỉnh prompt, khóa truy cập công khai, nhãn mô phỏng, landing, runbook, model 3D | Eval đạt mục tiêu; không còn lỗi chặn |
| **T6 16/10** | [Bạn] dựng tunnel/staging · tổng duyệt 1 · kết nối lại Google · tập chuyển sang dự phòng · mở link bệnh án trong tab ẩn danh trên một điện thoại khác · kiểm tra SSE qua tunnel không bị giữ lại | Chạy trọn kịch bản trên URL public |
| **T7 17/10** | Tổng duyệt 2 · [Bạn] lái xe buổi chiều để có dữ liệu cho câu "chiều qua" · quay lại một lượt demo đầy đủ · chỉ sửa lỗi chặn | Có video dự phòng của lượt chạy |
| **CN 18/10** | **Demo** | |

**Checklist cho ngày xe [Bạn]**, Claude hỗ trợ từ xa:
- Cắm thiết bị, chạy `--source obd`, lưu lại danh sách PID, VIN và giao thức xe trả về.
- Thử freeze frame và đọc DTC.
- Ghi các chuyến: nổ máy đứng yên 10 phút, chạy phố 20 phút, và một chuyến dài hơn nếu kịp.
- Ghi chú PID nào xe không hỗ trợ, và đo nhịp đọc thực tế của cục OBD.
- **Ghi nhiệt độ nước làm mát ổn định khi xe chạy bình thường** (máy đã ấm, chạy 10–15 phút). Nếu xe thường chạy gần 100–105°C, nâng `COOLANT_WARN_C` trong `backend/.env` (ví dụ lên 110) để không báo sai trước CEO.

---

## 6. Quy tắc hằng ngày
- Cuối mỗi ngày, các lệnh sau đều phải xanh:
  - `cd backend && .venv/bin/python -m pytest -q`
  - `cd frontend && npm test && node_modules/.bin/eslint . && node_modules/.bin/tsc --noEmit && node_modules/.bin/next build`
  - `cd gateway && pytest -q`
- Chế độ `backend` và `mock` cũ vẫn chạy cho tới khi đổi chế độ mặc định.
- Mọi dữ liệu mô phỏng mang nhãn "Mô phỏng": trong DB (`trips.simulated`), trên UI và trong câu trả lời của agent.
- Chỉ commit khi bạn yêu cầu. Gợi ý: làm trên nhánh `demo-1810`, cuối mỗi ngày commit một lần.

## 7. Thứ tự cắt khi trễ
1. Xe live → chỉ dùng phát lại.
2. Bản đồ trong hộp đen → chỉ giữ biểu đồ.
3. Hỏi xe → ô chat với câu gợi ý đã thử trước.
4. Freeze frame → chỉ mã DTC và lời giải thích (nếu xe hoặc cục OBD không trả Mode 02).

**Không cắt:** giải thích DTC, đặt lịch kèm bệnh án, chế độ phát lại, nhãn mô phỏng.

**"Dữ liệu xe thật đã ghi"** chỉ nằm trong nhóm không cắt nếu mượn được xe trước 13/10.

## 8. Kịch bản demo (khoảng 8–10 phút)

| # | Bước | Dự phòng |
|---|---|---|
| 1 | Cắm thiết bị, xe tự được nhận diện: VIN, hãng, X/Y cảm biến | Phát lại lần cắm đã ghi |
| 2 | Dữ liệu chạy trực tiếp; agent: "bình thường", có lý do | Phát lại một chuyến thật |
| 3 | Mã lỗi: DTC, freeze frame, giải thích, "garage sẽ kiểm tra" | Chuyến `misfire` của fake-elm (nhãn mô phỏng) |
| 4 | Hộp đen: phát lại chuyến quá nhiệt (nhãn "Mô phỏng"), cảnh báo ở 105°C trước khi chạm 120°C | — (đã là phát lại) |
| 5 | Hỏi xe: "Chiều 17/10 xe có nóng bất thường không?" | Câu gợi ý đã thử trước |
| 6 | Đặt lịch garage, rồi mở bệnh án trên điện thoại | Sự kiện và bệnh án tạo sẵn |

Phương án dự phòng cuối cùng là video 60 giây đã export.

## 9. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| Cục OBD chỉ có BLE, python-OBD không có cổng serial (cần kiểm tra) | Mua ELM327 USB; hoặc dùng cầu nối BLE-serial |
| Xe không hỗ trợ một số PID (oil, fuel, ambient…) | Dashboard ẩn thẻ đó; agent ghi vào `missing_data` |
| Xe hoặc cục OBD không trả freeze frame | Cắt bước 4 ở mục 7 |
| Báo sai trên dữ liệu thật | Trần mức độ theo detector, cộng eval ngày 15/10 |
| OpenAI chậm hoặc lỗi lúc demo | Timeout 45 s rồi dùng đánh giá theo luật; phát lại không cần LLM |
| Google hiện cảnh báo app chưa xác minh, hoặc token hết hạn | Kết nối trước, kết nối lại 16/10, có sự kiện tạo sẵn |
| Mất mạng tại địa điểm | Phát lại chạy trên laptop; bản đồ cần mạng nên lúc đó chỉ dùng biểu đồ |
| URL public bị người lạ truy cập | Mật khẩu demo, backend chỉ nghe 127.0.0.1, giới hạn số câu hỏi |
| Giấy phép model 3D | Quyết định 7 ở mục 1 |

## 10. Quy tắc cố định
- Key dịch vụ (OpenAI, LocationIQ, Google) chỉ nằm trong Python. Không dùng `NEXT_PUBLIC_` cho key; bản đồ dùng tile OSM, không cần key.
- Gateway không bao giờ gửi Mode 04 (xóa mã lỗi). Có test bảo đảm.
- Agent chỉ tư vấn. Mọi thao tác ghi (đặt lịch, nhắc nhở) phải qua bước xác nhận rõ ràng của người dùng.
- Dữ liệu mô phỏng luôn được gắn nhãn.
- Claude không tự dựng hay deploy hạ tầng, và chỉ commit khi bạn yêu cầu.
