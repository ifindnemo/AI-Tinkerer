# Vehicle Health Agent — Giới thiệu ý tưởng cho Team

## Ý tưởng là gì

Chúng ta xây một **agent sống bên trong chiếc xe**, không phải một app hỏi-đáp thông thường. Nó liên tục đọc dữ liệu từ ECU (RPM, nhiệt độ, tải động cơ...), tự phát hiện khi có gì bất thường — bắt đầu với kịch bản nóng máy — rồi **suy luận** xem đó là lỗi thật hay chỉ do thời tiết/điều kiện vận hành bình thường.

Điểm khác biệt so với một chatbot bình thường: agent không chỉ nói "xe bạn có vấn đề" rồi dừng lại. Nó **hỏi ý kiến người dùng và hành động tiếp theo** — tìm garage gần nhất, đặt lịch chỗ quen, hoặc nếu người dùng chưa muốn sửa thì đặt lịch nhắc lại sau. Nó cũng nhớ lịch sử, nên có thể nói "tình trạng này xe từng gặp cách đây 3 tháng."

**Tại sao đây là ý tưởng phù hợp cuộc thi:** đề bài yêu cầu agent sống trong một môi trường có sẵn, không phải chatbox độc lập. Với xe hơi, nếu tách agent ra khỏi dữ liệu ECU thời gian thực, nó không còn gì để làm — đây chính là điều ban giám khảo tìm kiếm nhất (agent mà giá trị cốt lõi không thể tái tạo ở nơi khác).

## Cách kể câu chuyện khi demo

Phần dữ liệu ECU (Speed, RPM, MAP, TPS...) sẽ được **mô phỏng** vì không có sẵn xe hỏng thật để test — đây là cách làm chuẩn trong ngành ô tô (tiêm lỗi có chủ đích để test hệ thống chẩn đoán). Nhưng **toàn bộ phần xử lý phía sau phải là thật**: repository, tính điểm sức khỏe xe bằng rule, gọi AI thật, xử lý phản hồi thật, lưu lịch sử thật. Ranh giới "giả lập" chỉ nằm ở đúng một chỗ — nguồn phát dữ liệu — không lan ra toàn hệ thống.

---

## Ưu tiên xây dựng — làm gì trước, làm gì sau

### Mức 1 — Bắt buộc phải chạy mượt, không thỏa hiệp
Đây là xương sống của demo, không có phần này thì mọi thứ khác vô nghĩa.

1. **Nguồn dữ liệu mô phỏng có kịch bản** — sinh baseline bình thường + có thể "tiêm" một kịch bản lỗi (nóng máy) theo yêu cầu
2. **Suy luận đa tín hiệu** — kết luận dựa trên ít nhất vài yếu tố kết hợp (nhiệt độ + tải động cơ + trạng thái quạt + mã lỗi), không phải một ngưỡng đơn giản kiểu "nhiệt độ > 100 thì báo lỗi"
3. **Hiển thị kết luận có evidence rõ ràng** — không chỉ "có lỗi/không lỗi" mà kèm lý do, mức độ tin cậy, để người dùng hiểu vì sao agent kết luận vậy

### Mức 2 — Quan trọng, làm ngay sau Mức 1
Đây là phần thể hiện tính "agentic" thật sự — agent hành động, không chỉ trả lời.

4. **Hỏi ý kiến người dùng trước khi hành động** — khi phát hiện Warning/Critical, agent hỏi thay vì tự quyết
5. **Một nhánh hành động hoàn chỉnh** — ví dụ: người dùng đồng ý → agent tìm/đề xuất garage → xác nhận lịch. Chỉ cần làm trọn vẹn **một** nhánh, chạy mượt từ đầu đến cuối

### Mức 3 — Làm nếu còn thời gian, có thể đơn giản hóa
Những phần này tăng chiều sâu nhưng có thể "cheat" một chút miễn là hoạt động được lúc demo.

6. **Garage quen biết + dời lịch quay lại bước trước** — dùng danh sách garage cố định thay vì tích hợp thật, vẫn thể hiện được vòng lặp
7. **Lưu và đối chiếu lịch sử** — seed sẵn 1-2 bản ghi giả định "xe từng gặp tình trạng này trước đây" để demo tính năng đối chiếu
8. **Cảnh báo định kỳ mỗi ngày** — dùng nút giả lập "tua sang ngày mới" trong demo thay vì chờ thời gian thật trôi qua

### Mức 4 — Không bắt buộc, chỉ cần nói bằng lời nếu hết giờ
9. **Tìm garage gần nhất qua API thật** (Google Places hoặc tương tự) — nếu không kịp làm, có thể giải thích đây là phần mở rộng đã thiết kế sẵn trong kiến trúc, chưa kịp nối vào bản demo

---

## Nguyên tắc chung khi phân việc

- Ưu tiên **một luồng hẹp chạy hoàn chỉnh** hơn là nhiều tính năng dở dang — một demo gọn không lỗi luôn ăn điểm hơn một demo tham vọng mà vỡ giữa chừng
- Bất cứ ai làm phần nào cũng nên hiểu rõ **ranh giới thật/giả lập** để trả lời tự tin nếu giám khảo hỏi trực tiếp
- Nếu thiếu thời gian, cắt ở Mức 3-4 trước, tuyệt đối giữ Mức 1-2 chạy ổn định
