# Handover: module camera giám sát chú ý của tài xế (`/driver`)

Lập ngày 11/10/2026. Người nhận: một AI/kỹ sư khác (GPT) sẽ làm tiếp. Mọi thứ dưới đây đã được đọc lại từ code và kết quả chạy thật; chỗ nào **chưa kiểm chứng** thì ghi rõ ở mục 11.

Repo: `/home/nemo/code/Testing/AI-Tinkerer-fe` (nhánh `fe`, remote `origin` = `github.com/ifindnemo/AI-Tinkerer`). **Toàn bộ phần camera chưa được commit.** Demo với CEO: **Chủ nhật 18/10/2026**.

**Cập nhật tiếp trong ngày 11/10:** xem mục 15 trước khi làm tiếp. Mục này bổ sung cảnh báo tại trình duyệt, UI/UX mới, sửa backend và kiểm thử mới; thay thế các mô tả cũ tương ứng về âm báo, lời agent và kiểm thử giao diện.

---

## 1. Mục tiêu và ràng buộc từ người dùng

Yêu cầu gốc (11/10): thêm tính năng dùng camera nhận diện khuôn mặt tài xế để đi demo; **tính năng blackbox/OBD cũ giữ nguyên**, tập trung vào camera. Đặc tả người dùng cung cấp:

- Module webcam sinh các **sự kiện có cấu trúc**: có mặt khuôn mặt hay không, thời gian nhắm mắt, hướng đầu, trạng thái chú ý, độ tin cậy.
- Trạng thái prototype lưu ở **local storage của trình duyệt**.
- **Không gửi video thô cho agent.** MVP không điều khiển xe, không gọi cứu hộ, không tuyên bố chứng nhận an toàn ô tô.

Yêu cầu thiết kế (sau đó): "tưởng tượng là motion graphic designer chuyên nghiệp", UI/UX **tối giản, đẹp, tập trung motion graphic, đừng để nhìn quá AI**.

Ràng buộc cố định của cả dự án (xem `frontend/AGENTS.md`):

- Khóa dịch vụ chỉ nằm trong Python, không bao giờ `NEXT_PUBLIC_`.
- **Không commit/push nếu người dùng không yêu cầu.** Không dựng hạ tầng.
- Dữ liệu mô phỏng luôn gắn nhãn.
- Next.js ở đây là phiên bản 16 với thay đổi phá vỡ: **đọc `frontend/node_modules/next/dist/docs/` trước khi viết code Next** (ví dụ `middleware` đã đổi tên thành `proxy`).
- Người dùng đọc tiếng Việt; chuỗi giao diện dùng `useLang().t(vi, en)`.

## 2. Kiến trúc tổng quát

```
Webcam ──► <video> (trong tab) ──► MediaPipe FaceLandmarker (WASM, chạy trong trình duyệt)
                                      │  landmarks + blendshapes (chỉ tồn tại trong bộ nhớ tab)
                                      ▼
                         toSample()  →  DriverFrame  (t, facePresent, closure, yaw, pitch, confidence)
                                      ▼
                         AttentionTracker.update()  →  DriverEvent  (có cấu trúc)
                                      │
              ┌───────────────────────┼─────────────────────────────┐
              ▼                       ▼                             ▼
        LiveChannel (rAF)      useDriverMonitor (React,        localStorage
        gauge/lens/avatar      ~5 Hz) → giao diện              (consent, cài đặt, lịch sử 180 s)
                                      │ mỗi giây 1 event, gửi lô mỗi 3 s hoặc ngay khi leo thang
                                      ▼
                  POST /api/driver/events (Next route, same-origin, ≤ 50 KB)
                                      ▼
                  FastAPI  driver/  →  rules.assess()  (mức độ = luật, quyết định)
                                      └► agent (nền, chỉ diễn đạt lại lời)  →  assessment
                                      ▼
                       trả về ngay assessment bằng luật; lời agent đến ở lô sau
```

Điểm thiết kế quan trọng:

1. **Video không rời tab.** `FaceLandmarker.detectForVideo(video)` đọc thẳng từ phần tử `<video>`; không có canvas capture, không `toDataURL`, không `Blob`, không `MediaRecorder`.
2. **Mức độ nghiêm trọng do luật quyết định**, agent chỉ viết lại `summary` và `recommendations`; không hạ được mức, không đổi `evidence`.
3. **Cảnh báo không chờ LLM**: backend trả ngay bản theo luật; lời agent thay vào ở lô kế tiếp nếu đã xong (mục 6.4).
4. Backend **không ghi gì xuống đĩa/DB** cho module này (bộ nhớ, tối đa 50 phiên × 120 sự kiện).
5. Phần xử lý (đặc trưng, máy trạng thái, hiệu chỉnh, mô phỏng, lưu trữ, client) là **hàm/lớp thuần**, test được không cần trình duyệt.

## 3. Bản đồ file

### Frontend (`frontend/`)

| File | Vai trò |
|---|---|
| `src/lib/driver/types.ts` | Kiểu: `AttentionState`, `HeadDirection`, `DriverFrame`, `DriverEvent`, `DriverBatch`, `DriverReply`, `DriverAssessment`. |
| `src/lib/driver/features.ts` | Hình học thuần trên landmarks: `headPose()` (yaw/pitch), `eyeReading()` (điểm nhắm mắt), `faceConfidence()`. **Chỗ duy nhất đảo dấu yaw** (mục 11). |
| `src/lib/driver/attention.ts` | `AttentionTracker`: máy trạng thái, ngưỡng (`DEFAULT_CONFIG`), PERCLOS. Thời gian chỉ lấy từ `frame.t`. |
| `src/lib/driver/calibration.ts` | `Calibrator`: học tư thế thẳng và ngưỡng nhắm mắt của từng người. |
| `src/lib/driver/camera.ts` | `startCamera()`, `toSample()`, `CameraError`. Tạo landmarker GPU trước, lùi về CPU; mã lỗi `insecure/unsupported/denied/no_camera/busy/model/other`. |
| `src/lib/driver/simulation.ts` | `simulatedSample()` cho 4 kịch bản: `attentive/drowsy/distracted/no_face`. |
| `src/lib/driver/client.ts` | `postDriverEvents()` + kiểm tra phản hồi (`isDriverReply`, bắt buộc `privacy.rawVideoReceived === false`). |
| `src/lib/driver/storage.ts` | `DRIVER_STORAGE_KEY = "car-neuron.driver.v1"`; giải mã phòng thủ, không bao giờ ném lỗi. |
| `src/lib/driver/sound.ts` | `AlertTone`: chuông WebAudio (không file âm thanh). Phải `prime()` trong click. |
| `src/lib/driver/live.ts` | `LiveChannel` (kênh khung hình cho hoạt ảnh) và `approach()` (làm mượt theo thời gian). |
| `src/hooks/use-driver-monitor.ts` | Điều phối: bật camera/mô phỏng, hiệu chỉnh, gom và gửi sự kiện, âm báo, lưu trữ, dọn dẹp. |
| `src/components/driver/driver-page.tsx` | Trang `/driver`: bố cục, chữ trạng thái trượt, dải lịch sử, thẻ agent, "Dữ liệu gửi đi". |
| `src/components/driver/lens.tsx` | Khung camera: video, góc ngắm bám mặt, hình đầu vẽ nét, hiệu chỉnh, nút điều khiển. |
| `src/components/driver/instruments.tsx` | `EyeGauge`, `HeadGauge`, `ConfidenceBar`. |
| `src/components/driver/driver.module.css` | Toàn bộ kiểu và chuyển động (746 dòng). |
| `src/components/driver/labels.ts`, `debug-line.tsx` | Nhãn VI/EN; dòng giá trị thô khi `?debug=1`. |
| `src/app/driver/page.tsx` | Trang Next (server component mỏng). |
| `src/app/api/driver/events/route.ts` | Proxy POST: same-origin, ≤ 50 000 ký tự, `publicPayload()` che khóa, lỗi qua `safeApiError`. |
| `public/mediapipe/` (23 MB) | `wasm/` (4 file từ npm `@mediapipe/tasks-vision` 0.10.21) + `face_landmarker.task` (3,7 MB) + `README.md` ghi nguồn. **Không dùng CDN.** |
| `tests/driver-attention.test.ts`, `tests/driver-pipeline.test.ts` | 16 + 7 test. |

File cũ được sửa: `components/garage.tsx` và `components/live/live-garage.tsx` (thêm link "Tài xế"), `components/site/site-header.tsx` (link ở trang chủ), `eslint.config.mjs` (bỏ qua `public/mediapipe/**`), `package.json`/`package-lock.json` (thêm `@mediapipe/tasks-vision` đúng phiên bản `0.10.21`; npm cũng sắp xếp lại thứ tự khóa, phụ thuộc cũ không đổi).

### Backend (`backend/`)

| File | Vai trò |
|---|---|
| `driver/schemas.py` | `DriverBatch`/`DriverEvent` (pydantic, **`extra="forbid"`** ở mọi cấp, alias camelCase), `DriverNarrative`. |
| `driver/rules.py` | `assess(events, moving) → RuleResult`: luật quyết định mức độ, lời, bằng chứng, khuyến nghị. |
| `driver/agent.py` | `submit()` chạy agent ở luồng nền; `_narrate` là hàm gọi OpenAI Agents SDK. |
| `driver/service.py` | `DriverService`: phiên trong bộ nhớ, chính sách khi nào hỏi agent, ghép kết quả. |
| `driver/routes.py` | `POST /api/driver/events`. Đăng ký trong `main.py`. |
| `tests/test_driver.py` | 29 test (đã gồm các ca tham số hóa). |
| `.env.example` | Thêm `DRIVER_AGENT_TIMEOUT_SECONDS=8`. |

## 4. Hợp đồng dữ liệu

### 4.1 Sự kiện (trình duyệt → backend), JSON camelCase

```json
{
  "schemaVersion": 1,
  "sessionId": "9f1c…-uuid (sinh mỗi lần bật camera/đổi kịch bản)",
  "source": "webcam | simulated",
  "context": {"vehicleMoving": true},
  "events": [{
    "capturedAt": "2026-10-11T02:00:01.250Z",
    "facePresent": true,
    "absentMs": 0,
    "eyes": {"closed": false, "closedMs": 0, "perclos": null, "score": 0.09},
    "head": {"direction": "forward", "yawDeg": 1.9, "pitchDeg": 1.0, "awayMs": 0},
    "state": "attentive",
    "confidence": 1
  }]
}
```

Giới hạn (backend): 1–60 sự kiện/lô; `sessionId` khớp `^[\w-]{8,64}$`; `capturedAt` phải có múi giờ (đổi về UTC); `yawDeg/pitchDeg` ∈ [−180,180]; `*Ms` ∈ [0, 3 600 000]; `confidence/perclos/score` ∈ [0,1]; `state ∈ {attentive, distracted, drowsy, no_face, uncertain}`; `direction ∈ {forward,left,right,up,down,null}`. Trường lạ (ảnh, landmarks, video…) → **422**.

### 4.2 Phản hồi (backend → trình duyệt)

```json
{
  "accepted": 5,
  "sessionId": "…",
  "state": "drowsy",
  "assessment": {
    "severity": "normal | warning | critical",
    "summary": "…", "evidence": ["…"], "recommendations": ["…"],
    "confidence": 0.9,
    "engine": "rules | agent",
    "fallbackReason": "pending | rules_mode | error | timeout | null",
    "state": "drowsy",
    "at": "2026-10-11T02:00:02+00:00"
  },
  "privacy": {"rawVideoReceived": false}
}
```

`fallbackReason`: `pending` = agent đang viết; `rules_mode` = `AGENT_MODE=rules`; `error`/`timeout` = agent lỗi hoặc quá `DRIVER_AGENT_TIMEOUT_SECONDS`. `null` khi `severity = normal` hoặc khi `engine = agent`.

## 5. Logic phía trình duyệt

### 5.1 Đặc trưng (`features.ts`)

- **Mắt:** điểm nhắm = trung bình blendshape `eyeBlinkLeft` và `eyeBlinkRight` (0 mở … 1 nhắm); `asymmetry = |L − R|`.
- **Hướng đầu từ landmarks 3D** (không dùng ma trận biến đổi, vì dấu của nó mơ hồ): `yaw = atan2(z454 − z234, x454 − x234)`; `pitch = atan2(z152 − z10, (y152 − y10)/aspect)`. Quy ước: **yaw > 0 = mũi chỉ về bên phải ảnh = tài xế quay sang trái của chính họ** (camera nhìn vào họ); **pitch > 0 = cúi xuống**. Chỉ số: 234/454 = hai má, 10 = trán, 152 = cằm.
- **Độ tin cậy** (heuristic, **không hiệu chuẩn**): `size × symmetry × pose`, với `size = clamp((faceWidth − 0.10)/0.12)`, `symmetry = 1 − clamp((asymmetry − 0.3)/0.4)` (0,6 nếu thiếu), `pose = 1 − clamp((|yaw| − 45)/25)`.

### 5.2 Máy trạng thái (`attention.ts`, mặc định `DEFAULT_CONFIG`)

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `eyesOn` / `eyesOff` | 0,55 / 0,40 | Ngưỡng nhắm / mở lại (trễ). Sau hiệu chỉnh: `eyesOn = clamp(median_mở + 0,35; 0,5; 0,75)`, `eyesOff = eyesOn − 0,15`. |
| `reopenToleranceMs` | 150 | Mắt mở lại dưới 150 ms không cắt đứt một lần nhắm (chống nhấp nháy). |
| `drowsyClosedMs` | 1500 | Nhắm liên tục ≥ 1,5 s → `drowsy` (microsleep). |
| `perclosWindowMs` / `perclosMinMs` / `perclosDrowsy` | 30 000 / 15 000 / 0,2 | Tỉ lệ thời gian nhắm trong 30 s; chỉ báo khi đã quan sát ≥ 15 s; ≥ 0,2 → `drowsy`. |
| `yawAway` / `yawBack` | 25° / 18° | Quay đầu ≥ 25° coi là rời đường; quay lại dưới 18° mới thôi (trễ). |
| `pitchAway` / `pitchBack` | 20° / 14° | Cúi/ngửa tương tự. |
| `awayMs` | 2000 | Rời đường liên tục ≥ 2 s → `distracted`. |
| `awayToleranceMs` | 300 | Liếc lại dưới 300 ms không đặt lại bộ đếm. |
| `noFaceMs` | 2000 | Mất mặt ≥ 2 s → `no_face` (trước đó là `uncertain`). |
| `minConfidence` | 0,5 | Dưới mức này → `uncertain`, **không bao giờ** báo `drowsy/distracted`. |
| `maxFrameGapMs` | 500 | Khoảng hở giữa khung dài hơn thì không cộng vào PERCLOS. |

Thứ tự ưu tiên trạng thái: `no_face` (mất mặt) → `uncertain` (tin cậy thấp) → `drowsy` → `distracted` → `attentive`. Hướng đầu tính **tương đối với tư thế thẳng đã hiệu chỉnh** (`baseline.yaw/pitch`). Nhãn hướng: yaw > 0 → `left`, yaw < 0 → `right`.

> Các ngưỡng lấy theo thực hành phổ biến (PERCLOS ≈ 0,15–0,2; microsleep ≈ 1,5 s), **chưa được hiệu chỉnh cho một xe/tài xế/camera cụ thể.**

### 5.3 Hiệu chỉnh (`calibration.ts`)

"Nhìn thẳng, mắt mở" trong 2,5 s; chỉ nhận khung có mặt, `confidence ≥ 0,6`, `closure < 0,45`; cần ≥ 15 khung. Kết quả: median yaw, pitch, và `eyesOn`. Sau 7,5 s mà thiếu khung → `failed`, hệ thống **vẫn chạy với ngưỡng mặc định** và hiện ghi chú nhỏ (không chặn người dùng). **Hiệu chỉnh không được lưu qua lần tải lại trang** (mỗi lần bật camera chạy lại).

### 5.4 Hook điều phối (`use-driver-monitor.ts`)

- Pha: `idle → starting → calibrating → running` (hoặc `error`). Mô phỏng vào thẳng `running`.
- Camera chạy ~15 lần phân tích/giây bằng `requestAnimationFrame`, giới hạn 66 ms, timestamp tăng nghiêm ngặt (`performance.now()`).
- **Mỗi giây một sự kiện** vào hàng đợi (cộng thêm một sự kiện khi đổi trạng thái hoặc leo thang). **Gửi** khi: đổi trạng thái so với lô đã gửi, hoặc ≥ 3 s kể từ lần gửi, hoặc **leo thang** (nhắm ≥ 2,5 s hoặc rời đường ≥ 4 s vừa vượt ngưỡng). Chỉ một yêu cầu bay cùng lúc; lỗi mạng giữ tối đa 60 sự kiện để gửi lại.
- React state cập nhật ~5 Hz (`UI_INTERVAL_MS = 200`); hoạt ảnh tần số khung hình đọc `LiveChannel` trực tiếp và ghi DOM, không qua state.
- **Âm báo** (WebAudio): phát khi mức độ tăng (warning: 2 nốt, critical: 3 nốt); khi đang `critical` lặp lại mỗi 8 s. Tắt được bằng nút loa; `AlertTone.prime()` gọi trong click để qua chính sách autoplay.
- Chuyển kịch bản mô phỏng = **phiên backend mới + tracker mới** (không mang PERCLOS/bộ đếm/hold sang kịch bản sau).
- Dọn dẹp: `reset()` dừng track camera, đóng landmarker, hủy timer và request đang bay; gọi khi dừng, đổi nguồn và khi unmount. `startWebcam` idempotent khi đang `starting` (an toàn với Strict Mode).

### 5.5 Lưu trữ (`storage.ts`)

`localStorage["car-neuron.driver.v1"] = {version:1, consent, settings:{sound, showVideo, vehicleMoving}, history:[[epochMs, state]…≤180]}`. Giải mã từng trường, rơi về mặc định nếu hỏng. Ghi tối đa mỗi 5 s (và ngay khi đổi cài đặt/dừng). `consent` được ghi khi bấm "Bật camera" nhưng **hiện không dùng để chặn gì** (sự đồng ý là chính cú bấm nút).

## 6. Logic phía backend

### 6.1 Luật (`rules.py`)

| Điều kiện | Mức | Ghi chú |
|---|---|---|
| Trạng thái `drowsy` **hoặc** có microsleep ≥ 2,5 s trong 60 s qua **hoặc** có sự kiện `drowsy` trong 20 s qua | `critical` nếu có microsleep ≥ 2 500 ms (cửa sổ 60 s), ngược lại `warning` | Hằng: `MICROSLEEP_CRITICAL_MS = 2500`, `MICROSLEEP_HOLD = 60 s`, `DROWSY_HOLD = 20 s`. Tính theo **thời gian sự kiện**, không phải số lượng sự kiện. Trạng thái trả về luôn là `drowsy` trong lúc giữ cảnh báo, tóm tắt đổi thành "Mắt đã mở lại, nhưng tài xế vừa có dấu hiệu buồn ngủ…". |
| `distracted` + xe chạy | `warning`; `critical` nếu `awayMs ≥ 4000` | |
| `distracted` + xe đứng yên | `normal` | "xe đang đứng yên". |
| `no_face` + xe chạy | `warning` | Gợi ý kiểm tra camera. |
| `no_face` + xe đứng yên | `normal` | |
| `uncertain` | `normal` | Nói rõ chưa đủ tin cậy; không cảnh báo. |
| `attentive` | `normal` | |

`episode_key = "<state>:<severity>"`; đổi khóa = đợt cảnh báo mới. "Xe đang chạy" là **công tắc thủ công** ở giao diện (giả định demo), chưa nối với tốc độ thật.

### 6.2 Dịch vụ (`service.py`)

- Phiên theo `sessionId`: `deque(maxlen=120)`, tối đa **50 phiên** (LRU). Sự kiện trùng `capturedAt` bị bỏ; sắp xếp theo thời gian.
- Khi **mức = normal**: xóa mọi trạng thái agent của phiên (không tốn LLM).
- Khi có cảnh báo và (khóa đợt mới **hoặc** ≥ 20 s kể từ lần hỏi trước) và không có yêu cầu đang chạy → `submit()` agent ở luồng nền. **Trả ngay bản theo luật** (`fallbackReason: "pending"`).
- Các lô sau: nếu future xong → dùng lời agent (nếu đúng khóa đợt); nếu quá `DRIVER_AGENT_TIMEOUT_SECONDS` (8 s) → bỏ, `timeout`; lỗi → `error`. Kết quả đến muộn bị bỏ qua.
- `AGENT_MODE=rules` → không bao giờ gọi LLM (`rules_mode`).
- **Mức độ luôn từ luật**; `evidence` luôn từ luật.

### 6.3 Agent (`agent.py`)

OpenAI Agents SDK, model `OPENAI_MODEL` (mặc định `gpt-4.1-mini`), `store=False`, đầu ra `DriverNarrative{summary ≤ 400 ký tự, recommendations 1–4}`. Chỉ nhận JSON có cấu trúc (`vehicle_moving`, bản đánh giá theo luật, ≤ 6 sự kiện gần nhất), **không có hình ảnh**. Prompt buộc: không đổi mức độ, không chẩn đoán y khoa ("chỉ nói có dấu hiệu"), không nói đã chứng nhận an toàn/điều khiển xe/gọi cứu hộ, khuyến nghị chỉ là hành động của tài xế. **Chưa từng chạy với key hợp lệ** (mục 11).

### 6.4 Vì sao cảnh báo không chờ agent

Bản đầu chờ agent tới 8 s; trong lúc chờ, cơ chế "một yêu cầu bay cùng lúc" của trình duyệt chặn lô leo thang, nên "Nguy hiểm" có thể đến chậm vài giây khi key hợp lệ. Đã sửa: luật trả ngay, agent ở nền. Có test `test_escalation_is_not_delayed_by_a_slow_agent`.

## 7. Thiết kế giao diện và chuyển động

Nguyên tắc (do reviewer và người dùng đặt ra): **một tâm điểm**, một kiểu chữ (Be Vietnam Pro, số `tabular-nums`), màu theo token thương hiệu, **không** glow/gradient/kính mờ/hạt/emoji, **không** lưới chấm khuôn mặt. Chuyển động chỉ để (a) mã hóa giá trị đang đo, hoặc (b) đánh dấu khoảnh khắc có ý nghĩa.

**Màu theo trạng thái:** attentive = accent xanh; distracted = `--warn`; drowsy = `--danger`; no_face/uncertain/idle = trung tính. Biến CSS `--state` / `--state-ink` đặt theo `data-state` của trang.

**Danh mục chuyển động:**

| Chuyển động | Loại | Cách làm |
|---|---|---|
| Góc ngắm 4 góc bám khuôn mặt, đổi màu theo trạng thái | Mã hóa dữ liệu | Ghi `transform/width/height` mỗi khung trong rAF, làm mượt bằng `approach()`; ánh xạ qua phép lật gương và `object-fit: cover`. |
| Mí mắt khép theo điểm nhắm mắt; vòng quanh mắt đầy tới 1,5 s | Mã hóa dữ liệu | `EyeGauge` ghi thuộc tính SVG mỗi khung. |
| La bàn nhìn từ trên xuống: đầu quay theo yaw, chấm theo pitch, quạt "đường phía trước" sáng khi trong ±25° | Mã hóa dữ liệu | `HeadGauge`. |
| Hình đầu vẽ nét (khi ẩn video hoặc mô phỏng) | Mã hóa dữ liệu | Mắt, mũi, miệng dịch theo yaw/pitch, mí theo điểm nhắm. |
| Chữ trạng thái lớn trượt: chữ cũ lên, chữ mới từ dưới (mặt nạ), 260–420 ms | Khoảnh khắc | `StateWord` giữ chữ cũ 320 ms rồi gỡ. |
| Góc ngắm "khóa" (scale 1,08 → 0,98 → 1) khi hiệu chỉnh xong | Khoảnh khắc | `data-locked`, 420 ms. |
| Thanh tiến trình hiệu chỉnh | Khoảnh khắc | `scaleX`. |
| Viền khung (ring) | Cảnh báo | `warning`: viền tĩnh; `critical`: "thở" chậm 2,4 s, **không nhấp nháy**. |
| Thẻ agent, các bước khuyến nghị trượt vào lần lượt (trễ 80 ms/bước) | Khoảnh khắc | `rise`. |
| Tiêu đề trang giới thiệu: từng dòng trượt lên qua mặt nạ | Khoảnh khắc | `lineIn`. |
| Dải 3 phút: các khúc cùng trạng thái gộp lại, `flex-grow` | Dữ liệu | |

**Bố cục:** cột trái dính (`position: sticky`) gồm khung camera 4:3 + dải "Không có camera? Thử mô phỏng" + công tắc "Xe đang chạy"; cột phải là phần đo (trạng thái, 2 đồng hồ, độ tin cậy, thẻ agent, dải lịch sử, "Dữ liệu gửi đi"). Dưới 980 px xếp một cột; dưới 560 px khung chuyển sang 3:4. Nút điều khiển trên khung (hiện/ẩn video, hiệu chỉnh lại, âm báo, dừng) mờ 40 % cho tới khi rê chuột vào (luôn rõ trên màn hình cảm ứng).

**Giảm chuyển động:** `globals.css` đã ép mọi animation/transition về ~0 khi `prefers-reduced-motion`; thông tin trạng thái vẫn đọc được bằng màu và chữ (đã chụp và kiểm tra).

**Nhãn minh bạch trên giao diện:** "Trực tiếp · xử lý trên máy · GPU/CPU", "0 khung hình gửi đi", thẻ "MÔ PHỎNG" khi giả lập, "Đánh giá theo luật" khi agent chưa phản hồi (trung tính, không báo động), dòng chân trang "Prototype. Không điều khiển xe, không gọi cứu hộ, chưa được chứng nhận an toàn ô tô.", ô "Dữ liệu gửi đi" hiện đúng JSON sự kiện mới nhất.

## 8. Quyền riêng tư và an toàn: cái gì được bảo đảm, bảo đảm bằng gì

| Cam kết | Cách bảo đảm | Kiểm chứng |
|---|---|---|
| Không có khung hình rời trình duyệt | Không có API nào trong code lấy dữ liệu ảnh ra khỏi `<video>`; kiểu `DriverBatch` không có trường nào chứa được ảnh | e2e chặn mọi request: chỉ thấy POST `/api/driver/events`, ≤ 852 byte, khóa đúng schema, không chứa `data:`/`blob:`/`base64` |
| Backend không nhận được ảnh dù client bị sửa | Schema `extra="forbid"` | 12 ca từ chối trong `test_driver.py` (ảnh, landmarks, video…) |
| Không tải mã/model từ bên ngoài | WASM + model nằm trong `public/mediapipe/` | e2e: 0 request ra ngoài `127.0.0.1` |
| Backend không lưu | Chỉ bộ nhớ | `test_nothing_is_written_to_disk_or_the_database` |
| Agent không thấy ảnh, không hạ được mức | Chỉ JSON có cấu trúc vào agent; mức độ từ luật | `test_alerts_come_from_the_rules_at_once…` |
| Không báo bừa khi kém tin cậy | `confidence < 0,5` → `uncertain` (tracker ở trình duyệt) | `frontend/tests/driver-attention.test.ts`: "low confidence never produces a drowsy or distracted claim"; backend: `test_no_face_and_uncertain` |

Lưu ý: camera cần **secure context** (`localhost` hoặc HTTPS). `http://<IP LAN>` sẽ không mở được camera; đã ghi trong README và `AGENTS.md`.

## 9. Cách chạy

```sh
# Thử nhanh (production, khuyến nghị cho demo)
cd backend && AGENT_MODE=rules EXTERNAL_TOOLS=off .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
cd frontend && npm run build && BACKEND_URL=http://127.0.0.1:8000 node_modules/.bin/next start --hostname 127.0.0.1 --port 3000
# mở http://localhost:3000/driver   (?debug=1 hiện giá trị thô; ?presenter=1 chỉ ảnh hưởng /garage)

# Toàn bộ test
cd backend  && .venv/bin/python -m pytest -q          # 91 test
cd gateway  && .venv/bin/python -m pytest -q          # 49 test
cd frontend && npm test                               # 93 test (23 test là của camera)
cd frontend && node_modules/.bin/eslint . && node_modules/.bin/tsc --noEmit && npx next build
```

`./dev.sh` cũng chạy được (dev mode). Ở `next dev`, dòng log `INFO … XNNPACK` của MediaPipe hiện qua `console.error` nên có huy hiệu "1 Issue" (vô hại).

**Trạng thái môi trường lúc viết:** server production đang chạy ở `127.0.0.1:3000` (frontend) và `127.0.0.1:8000` (backend, `AGENT_MODE=rules`, `EXTERNAL_TOOLS=off`, DB tạm trong thư mục scratchpad) để người dùng thử; tắt khi xong. DB thật `backend/vehicle_guardian.db` không bị chạm.

Biến môi trường backend liên quan: `AGENT_MODE` (`openai` | `rules`), `DRIVER_AGENT_TIMEOUT_SECONDS` (8), `OPENAI_MODEL`, `EXTERNAL_TOOLS`.

## 10. Những gì đã kiểm chứng (kèm bằng chứng)

- **Model thật** trên video khuôn mặt chính diện (ảnh mẫu `portrait.jpg` của MediaPipe → y4m → camera giả của Chromium): GPU delegate; yaw ≈ 1,8–1,9° (không phải ±180 → thứ tự mốc má 234/454 đúng); pitch ≈ 1–1,3°; điểm nhắm mắt khi mở ≈ 0,23–0,25 (dưới 0,45 nên hiệu chỉnh thành công); độ tin cậy 1,0; trạng thái "Tập trung". Camera mặc định (không có mặt) → `no_face` trong ~2,5 s và cảnh báo "Không thấy tài xế".
- **Mô phỏng đầu cuối** (backend chế độ luật, DB tạm): drowsy → `warning` rồi `critical` (≈ 5 s), giữ `critical` sau khi mắt mở lại; distracted → `warning` → `critical` khi xe chạy, `normal` khi tắt "xe đang chạy"; no_face → `warning`; đổi kịch bản không mang trạng thái cũ.
- **Giao diện:** 1440 px và 390 px (không tràn ngang), giảm chuyển động, `next dev` (Strict Mode, đổi kịch bản, ẩn video → hình đầu vẽ nét hiện đúng), dashboard garage cũ (Mock/API/OBD, `?presenter=1`) vẫn chạy, link `/driver` có ở trang chủ và hai thanh garage. Không lỗi console (ngoài dòng INFO nêu trên).
- **Lỗi đã tìm ra qua e2e và đã sửa:** cảnh báo `critical` biến mất ngay khi mở mắt (nay giữ 60 s); trạng thái kịch bản mô phỏng trước chạm kịch bản sau; cảnh báo có thể đến chậm khi agent thật chạy (nay không chờ); vòng nhắm mắt vẽ một chấm khi bằng 0 (ẩn khi < 1 %).

## 11. Chưa kiểm chứng và rủi ro đã biết (đọc kỹ trước khi tin demo)

1. **Trái/phải trên đầu quay thật chưa được thử.** Dấu của yaw dựa trên suy luận hình học và test trên landmarks tổng hợp, chưa có khuôn mặt quay thật. Cách thử: mở `/driver?debug=1`, quay đầu sang trái của chính bạn, nhãn phải là "Sang trái" (và `yaw` thô > 0). Nếu ngược: **đảo dấu `yaw` trong `headPose()` (`frontend/src/lib/driver/features.ts`)**, mọi nơi khác (nhãn, la bàn, hình vẽ) tự theo. Cũng chưa kiểm pitch (cúi xuống > 0) trên mặt thật.
2. **Ngưỡng chưa hiệu chỉnh.** `eyesOn 0,55`, PERCLOS 0,2, 25°/20°… là giá trị phổ biến, chưa thử trên camera, ánh sáng và tư thế ngồi thật của xe demo. Cần quay vài đoạn thật (ngồi bình thường, chớp mắt, nhắm mắt 2 s, liếc gương, nhìn điện thoại) rồi chỉnh `DEFAULT_CONFIG`.
3. **Agent thật chưa chạy.** Khóa OpenAI trong `backend/.env` trả **401 `invalid_api_key`** (kiểm tra ngày 05/10). Mọi cảnh báo hiện ghi "Đánh giá theo luật". Cần khóa mới (người dùng tự thay, không ghi vào repo) rồi thử một đợt cảnh báo để xem lời tiếng Việt, độ trễ, và `fallbackReason`.
4. **Chưa thử trình duyệt ngoài Chromium** (Firefox, Safari, Chrome trên điện thoại). Khuyến nghị Chrome cho demo.
5. **Chưa thử trong cabin thật:** ánh sáng gắt/ngược sáng, kính cận, kính râm, khẩu trang, góc camera lệch, nhiều người trong khung (`numFaces: 1` chọn một mặt, hành khách có thể bị chọn nhầm).
6. **Chỉ đo hướng đầu, không đo hướng nhìn của mắt.** Đầu hướng thẳng mà mắt liếc đi sẽ không bị phát hiện. Không có phát hiện ngáp.
7. **"Xe đang chạy" là công tắc tay**, chưa nối với tốc độ thật từ luồng OBD.
8. **Không có test tự động cho React** (hook, thành phần, hoạt ảnh); phần này chỉ được kiểm bằng các kịch bản Playwright chạy tay (nằm trong scratchpad, **không** nằm trong repo). Logic thuần và backend thì có test.
9. **Thiết bị yếu:** phân tích ~15 khung/giây; chưa đo CPU/pin. Nếu `detectForVideo` ném lỗi, khung đó bị bỏ qua im lặng.
10. **Giấy phép model:** `face_landmarker.task` tải từ kho `mediapipe-models` của Google; cần xem model card trước khi dùng thương mại. WASM thuộc gói npm (Apache-2.0).
11. **Dung lượng:** `public/mediapipe/` 23 MB; nếu commit sẽ làm repo nặng hơn (cân nhắc Git LFS hoặc tải về lúc cài đặt).
12. **Khung "KHÔNG THẤY TÀI XẾ" khi xe đứng yên** hiển thị `normal` ở backend nhưng giao diện vẫn hiện trạng thái `no_face`; thiết kế có chủ đích (không cảnh báo khi đứng yên) nhưng nên xem lại cách diễn đạt.

## 12. Việc đề xuất làm tiếp (theo thứ tự ưu tiên)

1. Người dùng thử `/driver?debug=1` trên đúng laptop/camera demo; chốt dấu yaw/pitch (mục 11.1).
2. Quay dữ liệu thật và chỉnh ngưỡng; cân nhắc thêm test hồi quy dùng các đoạn ghi (chỉ lưu giá trị đặc trưng, **không** lưu video, để giữ cam kết riêng tư).
3. Nối "xe đang chạy" với tốc độ thật từ luồng OBD (`/api/vehicles/{id}/stream`, tín hiệu `speed`), giữ công tắc tay làm chế độ ghi đè cho demo.
4. Có khóa OpenAI mới: chạy một đợt cảnh báo thật, đọc lời agent, chỉnh prompt nếu giọng điệu chưa đúng.
5. Thêm test tự động cho giao diện (đưa các kịch bản Playwright vào `frontend/scripts/` theo mẫu `verify-*.mjs`).
6. Nếu còn thời gian: phát hiện ngáp (`jawOpen`), theo dõi hướng nhìn của mắt, lưu hiệu chỉnh theo thiết bị, nhắc thay đổi khi nhiều khuôn mặt.
7. Tích hợp với phần agent xe: ví dụ khi có `critical`, gợi ý điểm dừng gần nhất (đã có `search_nearby_garages`/LocationIQ ở backend xe; **chưa** nối cho module này theo chủ đích, vì đặc tả người dùng không yêu cầu).
8. Chỉ commit/push khi người dùng yêu cầu; cây làm việc hiện còn thay đổi chưa commit của phần OBD/gateway đã push ở `6c30640` và của phần camera này.

## 13. Cạm bẫy cho người làm tiếp

- Đừng thêm bất cứ thứ gì đọc dữ liệu ảnh từ `<video>` ra ngoài landmarker (canvas, `ImageCapture`, `MediaRecorder`, `captureStream`). Nếu cần debug trực quan, vẽ từ **giá trị đã tính**, không từ ảnh.
- Đừng gửi landmarks lên backend ("để backend tính lại"): phá cam kết riêng tư và schema sẽ từ chối.
- Đừng cho agent đổi `severity`; mọi thay đổi mức độ đi qua `rules.py` và test.
- Mọi bộ đếm thời gian phải theo **thời gian sự kiện** (`frame.t`, `capturedAt`), không dùng `Date.now()` bên trong logic thuần; nếu không test sẽ phụ thuộc thời gian thật.
- `MIN_INTERVAL_MS` và timestamp của MediaPipe phải **tăng nghiêm ngặt**, nếu không `detectForVideo` ném lỗi.
- Khi sửa `driver.module.css`: `--ease` và các token (`--accent`, `--warn`, `--danger`, `--surface`…) đến từ `globals.css`; đừng tự đặt màu mới ngoài khối `.page`.
- Hành vi Next 16 khác kiến thức cũ; đọc docs trong `node_modules/next/dist/docs/` trước khi viết route/proxy/streaming.
- Trong môi trường này, lệnh `rm` có biến shell trong đường dẫn bị chặn; dùng đường dẫn tuyệt đối cụ thể. `pkill -f` có thể khớp nhầm chính shell; dùng `ss -ltnp` để tìm PID theo cổng rồi `kill`.
- Không in giá trị trong `backend/.env`; chỉ kiểm tra hình dạng/độ dài khi cần.

## 14. Tài liệu liên quan

- `frontend/AGENTS.md`, mục "Driver attention camera, `/driver` (2026-10-11)" (tóm tắt ngắn cho các agent).
- `README.md`, mục "Driver attention camera (`/driver`)".
- `docs/ke-hoach-demo-18-10.md` (kế hoạch demo tổng; đầu file có đoạn đổi trọng tâm 11/10).
- `frontend/public/mediapipe/README.md` (nguồn WASM và model).

## 15. Cải thiện UI/UX và độ tin cậy — 11/10/2026

Đã đọc cả đặc tả `README_VEHICLE_GUARDIAN_CAMERA.md` và tài liệu bàn giao này. Phạm vi vẫn là module `/driver`; không sửa luồng blackbox/OBD hay tích hợp điều khiển xe.

**Giao diện:**

- Bổ sung trạng thái phiên/kết nối, phân biệt camera thật và mô phỏng, hướng dẫn đặt camera. Các kịch bản mang tên đúng khả năng quan sát: quay đầu, mất khuôn mặt; không gán thành phát hiện điện thoại hay ghế trống.
- Quan sát hiện tại không còn bị thay bằng trạng thái của cảnh báo cũ. Sau khi mở mắt, có thể hiện “Tập trung” nhưng vẫn giữ huy hiệu nguy hiểm, viền đỏ và lời giải thích cảnh báo giữ lại; không khẳng định đã phục hồi.
- Đưa hướng dẫn của agent lên trước các đồng hồ. Thẻ agent không bị remount mỗi khi lời giải thích cập nhật.
- Các nút điều khiển có nhãn trên desktop, vùng bấm 44 px; có thể dừng khi camera đang khởi động. Mobile giữ điều hướng, tên dự án, nút mở camera gần khung hình và thanh cảnh báo cố định với liên kết tới hướng dẫn.
- `no_face`/`uncertain` không còn được diễn đạt là “Bình thường” khi chưa đủ tín hiệu. UI hỗ trợ VI/EN; **lời giải thích từ backend hiện vẫn là tiếng Việt**, theo hợp đồng ban đầu.

**Trình duyệt và camera:**

- `lib/driver/safety.ts` đánh giá ngay trên thiết bị và phát âm báo từ luồng lấy mẫu, không chờ API. Ngưỡng và thời gian giữ cảnh báo phải luôn đồng bộ với `backend/driver/rules.py`.
- Request hết hạn sau 5 giây, giữ hàng đợi có giới hạn và tự thử lại; phản hồi sai phiên/số lượng bị từ chối. Khi đổi trạng thái/giả định xe đang chạy, không dùng lại phản hồi đang chờ thuộc ngữ cảnh cũ.
- Tracker xóa bộ đếm nhắm mắt/quay đầu và cửa sổ PERCLOS khi mất mặt, tín hiệu kém hoặc gián đoạn khung hình > 500 ms. Thời gian không quan sát được không được tính thành nhắm mắt lâu. Cảnh báo đã xác lập vẫn được giữ bởi `DriverSafety` độc lập.
- Không xử lý lặp lại một khung video đứng yên. Nếu không đọc được khung mới trong 1 giây, phát mẫu không khả dụng; sau 2 giây mất mặt liên tục tracker chuyển sang `no_face`. Camera đứng hình không được giữ trạng thái tập trung cũ mãi.
- Hủy khởi động/dừng camera giải phóng media tracks, kể cả lúc đang tải model. Hiệu chỉnh lại hủy request đang chờ, không gửi lại mẫu cũ và không xóa cảnh báo còn hiệu lực.

**Backend:**

- Không dùng sự kiện thiếu mặt, `confidence < 0.5`, `uncertain` hoặc `no_face` để tạo/gia hạn cảnh báo buồn ngủ. Cảnh báo từ quan sát đáng tin cậy trước đó vẫn được giữ đúng cửa sổ thời gian.
- Loại trùng timestamp cả trong một batch lẫn giữa các batch.
- Hủy sử dụng lời agent cũ khi mắt mở lại, hướng đầu thay đổi hoặc giả định xe đang chạy thay đổi, kể cả khi mức nguy hiểm không đổi. Cùng đợt cảnh báo vẫn giới hạn gọi agent mỗi 20 giây; đổi ngữ cảnh không gọi lại ở từng lần chớp mắt. Đợt/mức cảnh báo mới có thể gọi ngay.
- Lỗi future/timeout vẫn trả kết quả theo luật. Mức độ, bằng chứng và các bước xử lý lấy từ luật; chỉ phần tóm tắt được agent diễn đạt lại. Khi đã đỗ xe, lời khuyên buồn ngủ là giữ xe ở nơi an toàn, không tiếp tục lái.

**Kết quả kiểm chứng của bản cập nhật:**

- `backend/.venv/bin/python -m pytest -q`: **101 passed**, gồm **39** test camera.
- `npm test`: **99 passed**, gồm **29** test camera. `npm run lint` và `npm run build` đều qua, bao gồm kiểm tra TypeScript của Next.
- Đã đưa kịch bản trình duyệt vào repo: `frontend/scripts/verify-driver-ui.mjs`. Chạy trên bản production, backend `AGENT_MODE=rules`, `EXTERNAL_TOOLS=off`, DB thử riêng.
- Playwright kiểm: cảnh báo tăng mức và giữ sau mở mắt; đổi kịch bản không lẫn cảnh báo; xe đỗ; mất mặt; request treo, timeout và kết nối lại; âm báo được tạo khi API chưa trả lời; VI/EN, bàn phím, reduced motion, không tràn/cắt nhãn tại 320/390/768/1024/1440 px; liên kết hướng dẫn mobile; từ chối quyền camera; giải phóng camera khi dừng và khi hủy tải model.
- Model MediaPipe thật đã chạy với camera giả phát video khuôn mặt mẫu từ `https://storage.googleapis.com/mediapipe-assets/portrait.jpg`, chuyển thành y4m, phóng khung vào khuôn mặt. Mặt chính diện → tập trung; tạm dừng video → mất tín hiệu và cảnh báo. Đây là kiểm tra đường xử lý thực, **không phải kiểm chứng tài xế/cabin thật hay độ chính xác phát hiện buồn ngủ**.
- Bản chạy kiểm chứng 19 batch JSON: không có ảnh/video/landmarks, không có request tài nguyên ra domain ngoài, không lỗi runtime/hydration. Ảnh kiểm tra nằm ở `/tmp/car-neuron-camera-ui/`.

Chạy lại (cần frontend và backend đã bật):

```sh
cd frontend
BASE_URL=http://127.0.0.1:3000 node scripts/verify-driver-ui.mjs
# Tùy chọn: video y4m khuôn mặt chính diện đủ lớn, mắt mở để kiểm thêm đứng hình:
BASE_URL=http://127.0.0.1:3000 CAMERA_VIDEO=/path/to/face.y4m node scripts/verify-driver-ui.mjs
```

Các giới hạn ở mục 11 về ngưỡng chưa hiệu chuẩn, đầu quay thật, cabin thật và LLM thật vẫn còn. Bản cập nhật này không kiểm tra khóa OpenAI và không phát sinh yêu cầu LLM thật; các ca agent chậm/lỗi/lời cũ được kiểm bằng future và runner giả lập.

## Camera source selection (11/10/2026)

`/driver` now lists browser-visible video input devices beneath the preview, including built-in webcams and USB cameras. Listing/selecting while idle does not request camera access. After permission is granted the list refreshes to reveal device labels; `devicechange` and the Refresh button update it when cameras are plugged in. The chosen ID is passed as an exact `getUserMedia` constraint, with no silent fallback to another camera.

Switching during a live camera session stops the old stream and starts a new backend session and calibration. Switching should happen while safely parked. Device IDs stay in browser memory, are not persisted, and are not added to backend event payloads. An ended video track stops monitoring, clears the stale observation and shows a reconnect message; the user must explicitly start again. Selecting a camera during simulation only chooses the next camera to start and does not open it.

Validation: `cd frontend && node scripts/verify-camera-switch.mjs` exercises two virtual camera devices backed by Chromium's fake stream, exact selection, old-track cleanup, unplug/recovery, explicit stop and mobile layout. This does not substitute for checking a physical USB camera on the demo machine.

## Update 11/10 (afternoon): Vehicle Guardian flow

The demo now centres on one decision loop that combines car and driver. See the "Vehicle Guardian flow" section of `frontend/AGENTS.md` for the rules. Code:

- Backend: `driver/guardian.py`, `driver/guardian_cases.json`, plus optional `vehicle`/`acknowledgedAt` fields in `driver/schemas.py`, Guardian wiring in `driver/service.py` and the Guardian prompt in `driver/agent.py`. Tests: `tests/test_guardian.py`.
- Frontend: `lib/guardian/{ecu,policy,types}.ts`, `components/driver/guardian-board.tsx`, plus ECU, confirmation and local policy in `hooks/use-driver-monitor.ts`. Tests: `tests/guardian-policy.test.ts`. The browser regression `scripts/verify-driver-ui.mjs` now covers the flow.
