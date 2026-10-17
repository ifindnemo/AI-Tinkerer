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
| Mở trang | Chrome hoặc Edge, bật tăng tốc phần cứng (GPU), `http://localhost:3000/garage?presenter=1&reset=1`. `reset=1` xóa dữ liệu tập (âm tắt, lịch sử, phiên cũ), giữ ngôn ngữ và cài đặt giọng; `presenter=1` ẩn công tắc nguồn dữ liệu. |
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

## 9. Im lặng, hỏi Neuron, ba tình huống

Nút nằm ở robot, góc dưới bên phải. Không cần "hey neuron".

| Nút | Khi nào |
|---|---|
| Tạm im lặng 60s | Còi hoặc giọng cảnh báo đang nói và cần yên để nói với CEO. Màn hình vẫn hiện mức nguy hiểm. Bấm **Bật lại** để nghe lại cảnh báo hiện tại, không phải hàng đợi cũ. |
| Hỏi Neuron | Cắt tiếng đang phát và nghe. Đang được đọc thì nút là **Ngắt lời và hỏi**. Có thể gõ vào ô trong bảng robot nếu micro lỗi. |
| Kết thúc | Tắt micro và bỏ câu đang chờ. Quiet còn giờ thì vẫn im. |
| Tạm dừng demo | Chỉ khi mở `?presenter=1` và dữ liệu là mô phỏng. Số liệu đứng yên và ghi rõ là ảnh chụp. OBD thật không có nút này. |

Ba tình huống, cùng một xe mô phỏng, theo thứ tự trên slide `/present` (bình thường trước, rồi lỗi, rồi buồn ngủ):

1. **Bình thường.** Kịch bản **Vận hành bình thường**, camera bật (hoặc **Mô phỏng: tỉnh táo**). Hỏi "How is the car now?" và "What are you monitoring?". Agent phải nói xe bình thường và nói đúng những gì nó theo dõi (số đo của xe, trạng thái tài xế qua camera). Không có cảnh báo nào để nghe lại.
2. **Lỗi, tỉnh táo.** Đổi kịch bản **Nóng nhẹ, đang chạy**. Đợi nước làm mát đứng khoảng 106 °C (khoảng 10 giây). Nghe cảnh báo, bấm Quiet, nói hệ thống vẫn theo dõi. Hỏi "Why are you warning me?", rồi "What should I do next?", rồi "Which garage is nearby?". Chỉ nói garage có trong câu trả lời. Không hứa đặt lịch bằng giọng nói. Câu trả lời không được dùng lại nội dung của tình huống bình thường như thể đó là tình trạng hiện tại.
3. **Cùng lỗi, buồn ngủ.** Bấm **Mô phỏng: buồn ngủ** trong ô camera (không thử trên xe đang chạy). Hỏi "Can I drive to that garage now?" và "Why is your advice different?". Câu trả lời phải là dừng và nghỉ, không phải cố lái tới garage. Bấm Kết thúc. Micro tắt.

Nếu cần thử lại chiều ngược (từ lỗi về bình thường), đổi sang **Vận hành bình thường**, đợi một gói mới và hỏi "How is the car now?": không được nghe lại cảnh báo của hai tình huống trước.

Lời tiếng Việt tương ứng: "Vì sao bạn cảnh báo?", "Tôi nên làm gì tiếp?", "Garage nào gần đây?", "Bây giờ tôi lái tới garage đó được không?", "Vì sao lời khuyên khác lúc nãy?", "Xe bây giờ thế nào?", "Bạn đang theo dõi những gì?".

Khi STT, LLM hoặc TTS lỗi: chữ trên bảng vẫn dùng được; gõ câu hỏi hoặc bấm thử lại. `--rules` vẫn trả lời từ luật. Nếu có chữ mà không có tiếng, đó là text-only, không phải "không có câu trả lời". Câu hỏi tiếp theo có 10 giây để **bắt đầu** nói; sau khi đã nói, câu có thể dài tới 20 giây. Wake "hey neuron" là nút riêng, tắt mặc định, và có thể gửi tiếng cho dịch vụ của trình duyệt. Nút Hỏi Neuron là đường demo. Khi micro đang bật, nút Kết thúc nằm ngay cạnh dòng "Micro đang bật".

Phần này đã được kiểm bằng test không gọi API trả phí. Micro, loa phòng và API Blaze thật chưa chạy trong lượt này: thử **Thử còi**, một câu nói, và một lần ngắt lời trên đúng máy demo trước Chủ nhật.


### Follow-up fix verification (2026-10-16)

- **Hey Neuron** now requires an explicit click to enable. End/close/hidden page disables it. During spoken answers use **Ngắt lời và hỏi / Interrupt and ask**, not a hands-free wake command.
- Follow-up gives 10 seconds to start, then up to 20 seconds of speech. Quiet speech can use **Gửi / Send**. Never demonstrate this while actually driving.
- Failed model reply: **Thử lại câu hỏi / Retry question** reuses the text with a fresh turn. Failed voice: the text stays; missing audio eventually opens the next listening window. End always closes capture.
- Before demo: verify one ordinary utterance, a quiet utterance, a long follow-up beginning after 8 seconds, two-part answer, interrupt, and browser microphone indicator after End with the actual mic/speaker. These physical/API checks remain unperformed in the offline regression run.
- If there has been no assessment for over 60 seconds, conversation describes it as stale; pause UI continues identifying a frozen snapshot. A previous mandatory stop is not cleared by staleness, quiet or End.


### Review corrections (2026-10-17)

Cập nhật sau cùng về lịch sử: đổi **scene hoặc ngôn ngữ** giữ lại các lượt cũ với màu dịu hơn và thêm dòng **Tình huống mới / Ngôn ngữ đã đổi**; nội dung cũ chỉ để đọc, không được gửi vào model hoặc thử lại. Conversation ID vẫn đổi. Đổi xe vẫn xóa panel. Quy tắc này thay thế mô tả xóa panel cho scene/ngôn ngữ trong các ghi chú cũ.

Đổi scene/xe/ngôn ngữ agent sẽ mở hội thoại mới; model chỉ thấy conversation hiện tại dù panel còn giữ lịch sử của scene/ngôn ngữ cũ. Để thử lệnh ngắt, bật **Hey Neuron** trước khi hỏi, đợi agent đọc rồi nói **Hey Neuron, stop**. Trong lúc đọc chỉ nhận lệnh đầy đủ, không nhận câu hỏi mới hoặc từ "stop" đứng riêng. **Kết thúc**, đóng panel hoặc ẩn tab sẽ tắt chế độ nghe. Khi trình duyệt không hỗ trợ/không cấp quyền, dùng **Ngắt lời và hỏi / Kết thúc**. Lệnh trên mic/loa thật chưa được xác minh bởi test giả lập.

### Đo độ trễ và chuẩn bị cache voice (2026-10-17)

Chạy từ thư mục repo trên **đúng máy demo**. Hai lệnh có opt-in dưới đây gọi Blaze thật và có thể tính phí; agent/CI không được tự chạy chúng. Khóa vẫn đọc từ `backend/.env`, không in ra màn hình.

```sh
# Xem câu luật, không gọi mạng; không đọc .env, nên có thể báo unconfigured.
backend/.venv/bin/python backend/scripts/prewarm_voice.py --dry-run
# Người dùng chạy một lần rồi gửi bảng kết quả để tìm chỗ chậm.
CAR_NEURON_ALLOW_PAID_TTS=1 backend/.venv/bin/python backend/scripts/tts_latency.py
# Chuẩn bị audio còn thiếu cho các câu luật với giọng đang chọn.
CAR_NEURON_ALLOW_PAID_TTS=1 backend/.venv/bin/python backend/scripts/prewarm_voice.py
```

Latency script bỏ qua cache, mặc định ba lần cho mỗi câu VI/EN ngắn/dài, tối đa 12 POST; `--repeat 1` giảm còn bốn. Bảng là median/max từ POST đến audio sẵn sàng, chưa gồm mạng từ trình duyệt, decode hoặc loa. Script không retry để giữ giới hạn request. Nếu lỗi, chỉ in loại lỗi và dừng.

Prewarm lấy câu từ luật thật: nóng nhẹ, quá nhiệt, buồn ngủ khi xe đang chạy, câu kế hoạch "Hãy nghỉ trước." / "Đừng tự lái xe đến garage.", cùng câu fallback dừng xe/dữ liệu cũ, ở cả VI và EN. Không gọi LLM.

**Câu cảnh báo được đọc ngắn và không đọc số** (2026-10-17): mức + một câu gọi tên tình huống + một bước, ví dụ "Cảnh báo. Động cơ đang nóng. Giảm tải động cơ và theo dõi nhiệt độ." hoặc "Cảnh báo nguy hiểm. Bạn có dấu hiệu mất tỉnh táo. Dừng tại vị trí an toàn gần nhất để nghỉ." Số (106,5 °C, 65 km/h), danh sách garage và phần "nếu tiếp tục tăng…" vẫn nằm trên màn hình, không đọc. Lý do: câu dài bị câu cảnh báo sau cắt ngang, và câu có số thì mỗi lần một khác nên không cache được. Sau câu cảnh báo, kế hoạch chỉ đọc câu đầu ("Hãy nghỉ trước."); câu đặt lịch (cần bạn bấm xác nhận) vẫn được đọc. Vì thế các câu trên giống hệt nhau ở mọi lần chạy và prewarm trúng cache bất kể nhiệt độ hay tốc độ.

Vẫn có thể miss khi: câu do LLM diễn đạt (lời agent, trả lời hỏi đáp), tên garage trong câu đặt lịch, hoặc đổi giọng/model/ngôn ngữ/tốc độ/format. Không hứa rằng mọi câu đều được làm nóng sẵn. Cache nằm ở `backend/var/voice-cache`, **không** bị `./demo.sh` xóa (thư mục `var/voice` thì có), nên chạy prewarm một lần là đủ cho các lần khởi động sau.

Một dòng log cho mỗi job (không chứa lời nói hoặc token):

```text
voice job key=<hash8> lang=en parts=3 queue_wait_ms=... synth_ms=[...] total_ms=... cache=hit|mixed|miss
```

`queue_wait_ms` đo chờ hàng đợi job; `synth_ms` đo từng phần từ lúc được phép gọi provider đến khi audio sẵn sàng (hit = 0), không tính chờ semaphore; `total_ms` tính từ submit đến kết thúc worker, kể cả chờ queue. Phần chạy đồng thời nên không cộng `synth_ms` để suy ra tổng. Log job bị hủy/lỗi có thể xuất hiện trước khi các request cũ đã chạy xong; audio hoàn thành muộn không được phát. Alert và talk có hai hàng đợi riêng, mỗi hàng hai worker; mỗi job tối đa ba phần, tổng tối đa bốn request Blaze. Cảnh báo không xếp sau job hội thoại; nếu provider đang đủ bốn request thì vẫn có thể phải chờ chỗ trống. Còi/mức nguy hiểm không chờ TTS.

Cache mặc định 200 audio / 100 MB, gồm dung lượng sidecar, dưới `backend/var/voice-cache` (cạnh thư mục voice, đổi bằng `BLAZE_VOICE_CACHE_DIR`; `./demo.sh` xóa `var/voice` nhưng không xóa thư mục này); ghi atomically, kiểm checksum/header (mọi khung đồng bộ MP3, ID3, WAV, Ogg, FLAC; header lạ thì ghi log `voice cache skipped` thay vì bỏ qua im lặng), xóa theo lần dùng gần nhất. File đang được clip sử dụng, chờ publish hoặc đang tải không bị xóa; nếu đầy do các file đó, câu mới vẫn phát bằng file tạm ngoài cache. `BLAZE_VOICE_CACHE=0` tắt đọc/ghi, `BLAZE_VOICE_CACHE_MAX_FILES` và `BLAZE_VOICE_CACHE_MAX_MB` đổi ngân sách. Các file `var/` đã được gitignore.

Mở `?debug=1` và DevTools Console để xem `car-neuron talk metrics`. `replyToAudioMs` là thời gian từ text được đưa vào state đến sự kiện audio-start đầu tiên: không âm/cancel = null, âm đến trước text = 0. Đây là phép đo trình duyệt, không xác nhận thời điểm loa thật phát ra tiếng. Không có query debug thì không log chỉ số này.

Trước demo: chạy ba tình huống, kiểm `cache=hit` khi lặp đúng câu, hỏi câu dài hai lần, và phát cảnh báo trong lúc hội thoại đang tổng hợp. Thử đổi scene/ngôn ngữ: lượt cũ còn đọc được dưới dòng phân cách, lượt mới không dùng lại ngữ cảnh cũ. Kiểm micro, ngắt lời, tiếng vọng phòng và loa thật; các test giả lập không xác minh được chúng. Chưa có số đo Blaze thật thì không công bố mức tăng tốc.

### Tối ưu độ trễ, lượt 2 (2026-10-17)

Kế hoạch: `plan-optimize-2026-10-17.md` (ghi chú nội bộ, không công khai trong repo).

- **Kết nối dùng chung.** TTS và STT dùng một pool HTTP keep-alive (`backend/http_pool.py`), không bắt tay TLS lại ở mỗi lượt. Chỉ lỗi kết nối mới được thử lại.
- **Poll clip nhanh hơn sau cảnh báo.** Trong 10 giây sau khi agent xe bắt đầu phân tích, mức cảnh báo tăng hoặc có lời cảnh báo mới, trình duyệt hỏi clip mỗi 400 ms thay vì 1000 ms.
- **Hỏi đáp đọc 2 câu đầu.** Chữ vẫn đầy đủ trên màn hình và trong lịch sử; giọng đọc hai câu đầu. Câu trả lời có chỉ dẫn dừng xe luôn được đọc đủ. `TALK_SPOKEN_SENTENCES=0` đọc hết, `1` đọc một câu. Danh sách garage nằm ở câu thứ ba thì không được đọc: nếu muốn nghe đủ khi demo, đặt `TALK_SPOKEN_SENTENCES=0` trước khi chạy `./demo.sh`.
- **Đo agent xe.** Mỗi lần chạy backend ghi một dòng log `agent run total_ms=… llm_calls=… tools=[tên:ms] instructions_chars=… input_tokens=… output_tokens=…` (logger `car_neuron.agent`). Các tool chạy song song nên đừng cộng thời gian của chúng. Đo riêng: `CAR_NEURON_ALLOW_PAID_LLM=1 backend/.venv/bin/python backend/scripts/agent_latency.py` (hai lần chạy, có gọi LLM thật và có thể tính phí; lần hai cho thấy prompt caching). Chưa có số đo thật nên chưa kết luận gì về việc tối ưu agent.
