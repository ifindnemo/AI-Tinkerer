# Tổng kết công việc ngày 11/10/2026

Chuẩn bị cho buổi demo trước CEO ngày **18/10/2026**. Trọng tâm của ngày: camera giám sát tài xế, nối camera với agent của xe (blackbox), cảnh báo bằng giọng nói và "gương mặt" robot cho agent.

## 1. Tình trạng mã nguồn

| Phần | Trạng thái |
|---|---|
| Camera `/driver`, luồng Vehicle Guardian, phim 90 giây, nhà cung cấp LLM Inworld | Đã commit `14059ee` và đẩy lên `main` |
| Voice Blaze từ nhánh `feat/voice` (commit `614122b`) | Đã kéo về nhánh local `fe` (fast-forward), **chưa đẩy** |
| Camera trong garage, voice cho agent, chỉnh giao diện (polish), robot agent | **Chưa commit** (khoảng 38 file thay đổi) |

Bản sao lưu trước khi kéo `feat/voice`: `git stash` mục `stash@{0}` ("camera+blackbox integration before feat/voice"). Có thể xoá khi đã ổn.

## 2. Camera giám sát tài xế (`/driver`)

- MediaPipe Face Landmarker chạy **ngay trong trình duyệt**. Mô hình và WASM được lưu sẵn trong `frontend/public/mediapipe/`, không tải từ CDN.
- Chỉ gửi chỉ số có cấu trúc (mắt nhắm bao lâu, hướng đầu, trạng thái, độ tin cậy). **Không bao giờ gửi hình hay video**; schema backend từ chối mọi trường lạ.
- Năm trạng thái: tập trung, mất tập trung, buồn ngủ, không thấy mặt, chưa chắc chắn. Có hiệu chỉnh ban đầu, chế độ mô phỏng 4 kịch bản và còi trên máy (không chờ AI).
- Giao diện tối giản theo hướng motion graphic.

## 3. Luồng Vehicle Guardian (ECU + camera + lịch sử bảo trì)

Theo tài liệu `README_VEHICLE_GUARDIAN_CAMERA`:

1. Chớp mắt bình thường thì không cảnh báo.
2. Nhắm mắt quá ngưỡng thì chuyển sang "giảm tỉnh táo".
3. Xe đang chạy thì kêu còi ngay.
4. Agent đọc ECU, camera và lịch sử bảo trì.
5. Agent khuyên **dừng ở vị trí an toàn gần nhất**, không đi tiếp đến garage ở xa.
6. Tài xế mở mắt và bấm **"Tôi đã tỉnh"**: hệ thống ghi nhận, nhưng cảnh báo kỹ thuật của xe vẫn giữ.

- Luật cố định nằm ở `backend/driver/guardian.py`, có bản sao trên trình duyệt `frontend/src/lib/guardian/policy.ts`. Cả hai cùng được kiểm thử theo một bảng ca `guardian_cases.json`.
- Ngưỡng nhiệt: cảnh báo từ 105 °C, bắt buộc dừng từ 120 °C. Con số 103 °C trong tài liệu chỉ là ví dụ.
- Quá nhiệt nghiêm trọng luôn yêu cầu dừng xe, bất kể tài xế ra sao.
- Tài xế không phản hồi sau 10 giây thì cảnh báo tăng lên mức nguy hiểm.

## 4. LLM qua Inworld

- `backend/llm_provider.py`: khi có `INWORLD_API_KEY`, mọi agent gọi Inworld Router (tương thích OpenAI), model lấy từ `LLMMODEL`.
- Đã thử thật: agent tài xế trả lời trong khoảng 4–5 giây; agent xe dùng tool calling trả lời trong khoảng 14 giây.

## 5. Camera trong trang Garage (blackbox)

- Thẻ **Camera tài xế** nằm ở cột phải của `/garage`, chế độ API và OBD.
- Camera **chỉ gửi khi có cảnh báo** (mức của tài xế tăng lên, hoặc khi tài xế xác nhận), không gửi liên tục. Mỗi lần gửi kèm các sự kiện của phút gần nhất và mã xe `bmw-m2`.
- Backend giữ cảnh báo của từng xe trong 60 giây (`backend/driver/registry.py`). Lần phân tích blackbox kế tiếp nhận khối `driver_attention`.
- Khi xe đang chạy và tài xế giảm tỉnh táo, agent xe:
  - nâng mức cảnh báo;
  - đưa bước "dừng tại vị trí an toàn gần nhất" lên đầu;
  - bỏ các gợi ý đi đến garage;
  - mở đầu phần nhận định bằng lý do về tài xế.
- Thẻ camera có ô chọn camera (kể cả camera USB) và nút tìm lại camera (xin quyền một lần). Khi chưa bật, khung camera thu gọn.

## 6. Cảnh báo bằng giọng nói (Blaze)

- Cảnh báo tài xế: **LLM viết câu ngắn để đọc**, Blaze đọc thành tiếng, trình duyệt phát. Nếu LLM chậm quá 8 giây hoặc lỗi thì đọc câu của luật.
- Cảnh báo của xe cũng được đọc, ở cả chế độ API và OBD. Không đọc lại nếu mức chỉ tăng vì tài xế, vì cảnh báo tài xế đã được đọc.
- Chống lặp: mỗi lượt cảnh báo chỉ đọc một lần; câu "cảnh báo" tới sau câu "nguy hiểm" thì bỏ.
- Backend có thêm `/api/voice/clips` để trình duyệt lấy clip về phát.
- **Sửa lỗi Blaze thật:** `/download` trả mã 425 khi đang xử lý, nên code giờ chờ thêm thay vì báo lỗi.
- **Cấu hình `.env`** (đã sửa, có bản sao lưu): `BLAZE_API_TOKEN`, `BLAZE_BASE_URL`, `BLAZE_SPEAKER_ID=HN-Nar-Nu-PhuongLy` (giọng nữ Hà Nội).
- **Bộ test không còn gọi Blaze thật.** Trước khi chặn, các lần chạy test đã tạo 17 câu ngắn trên tài khoản; file nằm trong `backend/var/voice`.

## 7. Robot agent (góc dưới bên phải)

- Robot đầu tròn từ [robot-heads](https://github.com/fayazara/robot-heads) (giấy phép MIT). Mã nguồn đã đọc được chép vào `frontend/src/vendor/robot-heads`, không cài từ npm vì gói mới đăng 2 ngày.
- Hiện ở `/garage` (API, OBD) và `/driver`. Khung tròn khoảng 128 px, không có bóng dưới chân, tốc độ mặc định.
- **Trạng thái theo trang:**
  - Bình thường: theo dõi.
  - Agent phân tích: suy nghĩ.
  - Camera bật: lắng nghe.
  - Blaze đọc: nói.
  - Tài xế xác nhận hoặc hết cảnh báo: vui.
  - Mất backend: lỗi.
  - Chưa có dữ liệu xe: ngủ.
- **Bong bóng chat:** hiện mọi cảnh báo thành chữ, kể cả khi tắt tiếng; khi Blaze đọc thì hiện đúng câu đang đọc.
- **Tương tác:**
  - Mắt nhìn theo chuột trên toàn trang.
  - Bấm robot mở bảng nhanh: Nghe lại, Tắt/Bật tiếng, Xem chi tiết.
  - Phím Esc đóng bảng hoặc bong bóng.
  - Chấm báo cảnh báo chưa xem.
  - Ngủ gật sau 90 giây không thao tác.
- **Máy không có GPU:** robot đứng yên, chỉ chuyển động khi nói. Lý do: khi chuyển động cạnh mô hình 3D, việc chuyển trang chậm từ 0,2 giây lên 10 giây.

## 8. Chỉnh giao diện (`/impeccable polish`) cho Garage và Home

- Đã cài skill `impeccable` vào `~/.claude/skills/impeccable`.
- **Garage:**
  - Khung agent nằm trên màn hình đầu tiên.
  - Chữ tối thiểu 11 px.
  - Vùng bấm tối thiểu 24 px.
- **Home:**
  - Sửa câu "Agent OpenAI (gpt-4.1-mini)" thành "Agent LLM qua Inworld Router".
  - Tiêu đề không còn ngắt "dữ / liệu".
- **Toàn site:** màu bôi đen chữ, con trỏ nhập liệu và thanh cuộn theo bảng màu của trang.

## 9. Kiểm tra

- Backend: 181 test qua.
- Frontend: 121 test qua; lint và typecheck sạch.
- Script trình duyệt PASS: `verify-driver-ui`, `verify-navigation`, `verify-camera-switch`, `verify-motion`, `verify-garage-camera`. Riêng `verify-garage-camera` đã chạy cả với Blaze thật và gateway OBD giả.
- `verify-session-recovery` đang lỗi vì tìm nút "Inject Overheating" đã bị bỏ từ lần làm lại garage trước. Lỗi này có từ trước, không liên quan đến các thay đổi hôm nay.

Chạy lại:

```sh
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm test && npx eslint src scripts tests
BASE_URL=http://127.0.0.1:3000 node scripts/verify-driver-ui.mjs
EXPECT_VOICE=1 MODE=backend node scripts/verify-garage-camera.mjs   # cần Blaze trong backend/.env
```

## 10. Việc còn lại trước 18/10

1. **Đặt lịch chưa chạy được thật:**
   - Chưa có `backend/token.json` (cần đăng nhập Google một lần trên máy demo).
   - Frontend chưa có giao diện đặt lịch.
   - Cần chọn một trong hai hướng: Google Calendar thật, hoặc lưu lịch trong hệ thống kèm tải file `.ics`.
2. **Kiểm tra hướng quay đầu trái/phải trên mặt thật** bằng `/driver?debug=1`.
3. **Máy demo:** bật tăng tốc phần cứng (GPU) trên trình duyệt; dùng `next build && next start`.
4. **Commit và đẩy** phần camera trong garage, voice và robot khi đã duyệt xong; sau đó xoá `stash@{0}`.
5. **Đề xuất chưa làm:**
   - Bỏ nhãn nhỏ phía trên tiêu đề trên toàn site.
   - Trang Home thêm mục giới thiệu camera và giọng nói (cần duyệt nội dung).
   - Chạy `/impeccable init` để có `PRODUCT.md`.

Chi tiết kỹ thuật cho người làm tiếp: `frontend/AGENTS.md` (các mục Driver camera, Vehicle Guardian, Voice, Agent robot) và `docs/handover-driver-camera.md`.
