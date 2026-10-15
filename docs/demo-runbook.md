# Runbook demo Car Neuron — Chủ nhật 18/10/2026

Sân khấu duy nhất: **`/garage`** (blackbox mô phỏng + camera tài xế + agent thật). Kịch bản theo
[README_VEHICLE_GUARDIAN_CAMERA](README_VEHICLE_GUARDIAN_CAMERA.md): xe đang chạy hơi nóng, tài xế nhắm mắt,
còi kêu ngay, agent khuyên **dừng ở chỗ an toàn gần nhất** chứ không đi tiếp tới garage xa.

## 1. Chuẩn bị (làm trước một ngày, trên đúng máy và phòng demo)

| Việc | Cách làm |
|---|---|
| Cài môi trường | Chạy `./dev.sh` một lần (tạo `backend/.venv`, cài `node_modules`), tắt đi. Dùng cùng phiên bản Python/Node với lần tập. |
| Khóa dịch vụ | `backend/.env`: `INWORLD_API_KEY` + `LLMMODEL` (hoặc `OPENAI_API_KEY`), `BLAZE_API_TOKEN` + `BLAZE_SPEAKER_ID` (giọng tiếng Việt) và `BLAZE_SPEAKER_ID_EN` (giọng tiếng Anh, lấy từ `GET /v1/voices`; không có thì agent tiếng Anh chỉ hiện chữ), `LOCATIONIQ_ACCESS_TOKEN` (garage gần xe). Không gửi `.env` lên git. |
| Thử LLM thật | `backend/.venv/bin/python backend/scripts/llm_preflight.py` → in nhà cung cấp, model, độ trễ. Lỗi thì sửa `LLMMODEL`/khóa trước khi lên sân khấu. |
| Chạy | `./demo.sh` (build production lần đầu, chỉ nghe `127.0.0.1`). Không dùng `dev.sh` trên sân khấu: lưu một file `.py` sẽ khởi động lại backend giữa chừng. |
| Mở trang | Chrome hoặc Edge, bật tăng tốc phần cứng (GPU), `http://localhost:3000/garage?presenter=1&reset=1`. `reset=1` xóa dữ liệu tập (âm tắt, lịch sử, phiên cũ); `presenter=1` ẩn công tắc nguồn dữ liệu. |
| Máy | Cắm sạc, tắt ngủ/dim màn hình, tắt thông báo hệ điều hành, đóng Teams/Zoom (chúng chiếm camera), chỉ mở **một** tab. |
| Âm thanh | Bấm **Thử còi** trong ô camera (ô phải trên), chỉnh âm lượng loa phòng họp. Chip phải ghi "Còi và giọng nói bật". |
| Màn hình | Laptop 1366×768: bấm Ctrl và dấu trừ (thu nhỏ trình duyệt còn khoảng 90%) để cả nút **Tôi đã tỉnh** và dòng còi nằm trong màn hình đầu. Máy 1080p thì không cần. |
| Camera | Ngang tầm mắt, mặt trọn khung, cách 50–80 cm, ánh sáng từ phía trước (không ngược sáng). Đánh dấu chỗ ngồi. Mở `/driver?debug=1` một lần để xem độ tin cậy (từ 0,8 là tốt). |
| Dự phòng | Quay sẵn video màn hình 60–90 s có tiếng còi (xem mục 5), chép ra ổ ngoài cùng `backend/.venv`, `frontend/node_modules`, `frontend/.next`. |

Nếu mạng hoặc LLM không tin cậy: `./demo.sh --rules` (không gọi LLM hay dịch vụ trả phí; câu trả lời ghi "Đánh giá theo luật").
Đổi `AGENT_MODE` cần khởi động lại backend.

## 2. Kịch bản 7 bước (khoảng 2 phút)

Trước khi bắt đầu: chọn kịch bản **"Nóng nhẹ, đang chạy (kịch bản camera)"** ở ô Kịch bản. Xe chạy khoảng 65 km/h,
nước làm mát giữ khoảng 106 °C (trên ngưỡng cảnh báo 105 °C, dưới ngưỡng dừng bắt buộc 120 °C). Chờ khoảng 10 giây
cho nhiệt độ lên mức đó. README ghi 103 °C làm ví dụ; sản phẩm cảnh báo từ 105 °C, nên màn hình hiện khoảng 106 °C.

| # | Làm gì | Màn hình | Lời nói gợi ý |
|---|---|---|---|
| 1 | Bấm **Bật camera**, ngồi thẳng 3–8 s (hiệu chỉnh) | Khung bám mặt; "Tỉnh táo"; dòng "0 khung hình gửi đi" | "Dữ liệu xe là mô phỏng. Hình ảnh không rời trình duyệt, chỉ gửi chỉ số." |
| 2 | Chớp mắt bình thường vài lần | Không cảnh báo | "Chớp mắt thường không báo." |
| 3 | Nhắm mắt liên tục 2–3 s | Sau khoảng 1,5 s: "Giảm tỉnh táo" + còi hai âm cao-thấp; từ 2,5 s: mức "Nguy hiểm" | "Camera tạo sự kiện có cấu trúc cho agent." |
| 4 | (không làm gì) | Hàng "Cảnh báo an toàn: Cảnh báo tài xế ngay" (nguồn Safety policy); còi kêu tại máy | "Còi do luật an toàn phát ngay tại máy, không chờ AI." |
| 5 | Chỉ vào dải Vehicle Guardian (ô blackbox: hàng dưới, bên trái, ngay dưới xe 3D) | Tốc độ, nước làm mát, trạng thái tài xế, thời gian nhắm mắt, cảnh báo, đề xuất, mỗi dòng có nguồn; lịch sử bảo trì (mô phỏng) | "Agent đọc ECU, camera và lịch sử bảo trì, không đọc video." |
| 6 | Chỉ vào thẻ Car Neuron Agent (ô agent: hàng dưới, bên phải) | Hàng "Đề xuất: Dừng ở vị trí an toàn gần nhất"; thẻ agent ghi "Agent AI · mức và bước do luật" (hoặc "Đánh giá theo luật · agent đang viết…" cho tới khi LLM trả lời, thường 4–5 s); robot đọc lời bằng giọng nói | "Xe nóng nhẹ mà tài xế mất tỉnh táo thì dừng gần nhất, không chạy tới garage xa." |
| 7 | Mở mắt, nhìn thẳng, bấm **Tôi đã tỉnh** (chỉ bật khi mắt mở, nhìn thẳng) | "Đã ghi nhận phản hồi · Cảnh báo kỹ thuật của xe vẫn được giữ" | "Phản hồi của tài xế được ghi nhận, nhưng cảnh báo của xe vẫn còn." |

Vài điểm cần biết:
- Còi có nút **Tắt còi** ngay trong thẻ (chỉ hiện khi đang có cảnh báo). Tắt còi chỉ có hiệu lực cho cảnh báo đó: mức cao hơn, dừng bắt buộc hoặc cảnh báo mới sẽ kêu lại. Nó không ẩn chữ cảnh báo.
- Quay đầu từ 25° trở lên liên tục khoảng 2 s sẽ ra "Mất tập trung" kèm còi: đặt camera ngay trên màn hình để người trình bày nhìn thẳng vào camera.
- Agent xe (ô agent, hàng dưới bên phải) và dải trạng thái trên cùng cập nhật theo gói blackbox 15 mẫu (khoảng 15 s). Khi camera báo động và backend đã nhận, gói đang gom (từ 5 mẫu) được gửi sớm, nên agent thường trả lời trong vài giây; tối đa một gói sớm mỗi 20 s. Câu "dừng tại vị trí an toàn gần nhất" xuất hiện ở đó trong vòng 60 s kể từ lúc cảnh báo tài xế. Mục "Cơ sở & mức độ chắc chắn" của agent xe mặc định gập: bấm để mở khi cần chỉ bằng chứng.
- "Nhắm mắt lâu nhất · 60 s" là đỉnh trong 60 giây, nên vẫn hiện số cũ sau khi mở mắt.

**Màn 2 (hỏi đáp, không bắt buộc):** chọn kịch bản **"Động cơ quá nhiệt"**. Nước làm mát lên 122 °C sau khoảng 42 s,
mã P0217 xuất hiện: hành động **bắt buộc** là tấp vào nơi an toàn và tắt máy, bất kể trạng thái tài xế (README, tình huống 3).

## 3. Đeo kính, ánh sáng

Chưa kiểm tra trên người thật (xem mục 7). Nếu tài xế đeo kính:
1. Hiệu chỉnh khi **đã đeo kính** (nhìn thẳng, mắt mở vài giây).
2. Tránh đèn chiếu thẳng vào mắt kính (phản chiếu làm mất tín hiệu mắt). Nếu thẻ báo "Chưa chắc chắn", thử nghiêng đầu nhẹ hoặc đổi góc đèn.
3. Kiểm tra bằng 10 lần chớp (phải không báo) và 10 lần nhắm 3 s (phải báo). Nếu kính làm báo nhầm hoặc không báo, dùng chế độ **Mô phỏng: buồn ngủ** và nói rõ đó là mô phỏng.

## 4. Sự cố thường gặp

| Sự cố | Xử lý |
|---|---|
| "Chưa chắc chắn" | Ngồi gần hơn, thêm sáng phía trước; không được thì chuyển sang mô phỏng. |
| Còi không kêu | Xem dòng "Còi và giọng nói bật"; bấm **Thử còi**; kiểm tra loa. Chip "Âm thanh đang tắt": bấm **Bật âm** (cài đặt này được nhớ giữa các lần mở trang). |
| Không có giọng nói | Chữ, còi và robot vẫn có. Blaze chưa cấu hình hoặc đang chậm; không ảnh hưởng cảnh báo. |
| Đổi ngôn ngữ agent / giọng nói | Thẻ **Agent trả lời bằng** (đầu ô agent, hàng dưới bên phải): *Theo giao diện* (mặc định, theo nút VI/EN trên cùng), *Tiếng Việt* hoặc *English*. Một lựa chọn cho cả chữ và giọng đọc; cảnh báo tiếp theo sẽ ra bằng ngôn ngữ đó (cảnh báo đang hiện giữ nguyên ngôn ngữ cũ). Cạnh đó có nút bật/tắt giọng nói và thanh âm lượng. Mức cảnh báo và bước bắt buộc không đổi theo ngôn ngữ. |
| Chọn English mà không nghe giọng | Dòng trạng thái ghi "Giọng tiếng Anh chưa cấu hình trên backend": thiếu `BLAZE_SPEAKER_ID_EN`. Chữ và còi vẫn có; giọng tiếng Việt không đọc câu tiếng Anh. Muốn nghe: thêm `BLAZE_SPEAKER_ID_EN` rồi khởi động lại backend. |
| Agent chậm hoặc lỗi | Thẻ ghi "Đánh giá theo luật": vẫn hợp lệ (mức và bước vẫn do luật). Bảng agent xe tự dùng luật sau 30 s. |
| Backend vừa khởi động lại | Tải lại trang. |
| Camera bị chiếm (Teams, Zoom, tab `/driver`) | Đóng ứng dụng/tab đó rồi bấm Bật camera. |
| Camera rớt giữa chừng | Bấm **Bật camera** lại, hoặc **Mô phỏng: buồn ngủ** để tiếp tục. |
| Trang 3D giật (máy không có GPU) | Bật tăng tốc phần cứng trong Chrome/Edge, hoặc dùng máy có GPU rời. |
| Mạng yếu | `./demo.sh --rules`. |

Thang dự phòng: **A** webcam trực tiếp → **B** nút "Mô phỏng: buồn ngủ" (có nhãn "Mô phỏng") → **C** video quay sẵn → **D** trang `/film`.

## 5. Video dự phòng

Quay hai video màn hình 60–90 s có tiếng còi: một lượt đầy đủ 7 bước bằng webcam, một lượt dùng chế độ mô phỏng. Người đóng vai
tài xế phải đồng ý. Không đưa video có hình mặt vào repo. Phát bằng trình phát riêng. Mở `/film` một lần trên đúng trình duyệt
demo (cần H.264).

## 6. Quyền riêng tư (câu trả lời nếu bị hỏi)

- Hình ảnh camera xử lý trong trình duyệt và không rời khỏi đó; backend chỉ nhận chỉ số có cấu trúc (schema từ chối trường lạ).
- Backend giữ chỉ số trong bộ nhớ; câu cảnh báo đã đọc được lưu tạm ở `backend/var/voice` và bị xóa mỗi lần chạy `./demo.sh` (trừ khi dùng `--keep`).
- Trình duyệt lưu cài đặt và ba phút lịch sử trạng thái trong `localStorage`; `?reset=1` xóa chúng.
- Hệ thống không điều khiển xe, không gọi cứu hộ, chưa được chứng nhận an toàn ô tô.

## 7. Số liệu thử nghiệm (README yêu cầu; công bố trung thực, không gọi là kiểm định an toàn)

Thu bằng quy trình thủ công trên đúng máy, camera, chỗ ngồi; chốt hằng số **trước** khi đo và không đổi sau đó.
Dùng `/driver?debug=1` để xem độ tin cậy; ghi kết quả vào một bảng tính hoặc `docs/so-lieu-thu-nghiem.md`.

| Khối | Điều kiện | Số lần | Ghi |
|---|---|---|---|
| A. Mắt mở | 3 khoảng cách, mỗi chỗ 30 s | 3 | Độ tin cậy; chọn chỗ từ 0,8 |
| B. Chớp thường | Không kính, đèn bình thường | 10 chớp × 3 lượt | Số cảnh báo (kỳ vọng 0) |
| C. Nhắm theo ngưỡng | Nhắm 3 s | 10 | Số lần báo / tổng; độ trễ từ lúc mắt đóng tới chuông (xem video quay màn hình, tối đa 10 mẫu) |
| D. Kính, ánh sáng yếu | Lặp B và C có kính; lặp với đèn tắt hoặc quay lưng cửa sổ | ≥ 5 mỗi loại | Như B và C |
| E. Báo nhầm | Nhìn xuống bàn phím 30 s × 3; quay đầu nói chuyện 10 s × 3; 5 phút làm việc bình thường | | Số cảnh báo, tính theo phút |

Tổng hợp: tỷ lệ phát hiện đúng, tỷ lệ báo nhầm theo phút, độ trễ trung bình và lớn nhất, kèm điều kiện thử (máy, camera, khoảng cách, ánh sáng, kính).
Dòng đầu tài liệu: "Mẫu nhỏ, đánh giá prototype, không phải kiểm định an toàn." Các con số "1,5 s" trong tài liệu kỹ thuật là ngưỡng cấu hình và
kết quả của bộ kiểm thử tổng hợp, không phải số đo trên người thật.

## 8. Giới hạn đã biết

- Chưa đo trên người thật: ngưỡng, kính, ánh sáng yếu, dấu hướng quay trái/phải (`/driver?debug=1`; nếu quay trái hiện "Sang phải", đảo dấu `yaw` trong `headPose()` ở `frontend/src/lib/driver/features.ts`).
- Độ trễ LLM và Blaze chưa đo trên máy demo (chạy `llm_preflight.py`; agent tài xế khoảng 4–5 s, agent xe có công cụ khoảng 14 s theo `docs/tong-ket-11-10.md`).
- Trang 3D cần GPU thật; trên máy render phần mềm trang rất chậm (đo được chỉ vài khung hình/giây).
- Đặt lịch garage không nằm trong phạm vi demo (README, mục "Phạm vi bắt buộc"); chưa có `backend/token.json` và chưa có giao diện đặt lịch.
