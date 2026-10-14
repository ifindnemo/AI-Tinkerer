# Vehicle Guardian với camera làm giác quan bổ sung

## Mục tiêu của bản nâng cấp

Vehicle Guardian hiện phân tích dữ liệu ECU để phát hiện bất thường, giải thích tình trạng của xe và đề xuất cách xử lý. Bản nâng cấp bổ sung camera để hệ thống hiểu thêm trạng thái của người lái và các dấu hiệu có thể quan sát được bên ngoài xe.

Camera không thay thế ECU và cũng không tạo thành một sản phẩm chống ngủ gật độc lập. Camera là một nguồn dữ liệu bổ sung cho cùng một agent. Agent kết hợp dữ liệu kỹ thuật của xe, quan sát từ camera và lịch sử bảo trì để đưa ra lời giải thích phù hợp với tình huống thực tế.

Nguyên tắc sản phẩm:

> ECU cho biết xe đang như thế nào. Camera cho biết người lái và môi trường quan sát được đang như thế nào. Safety policy xác định khi nào phải cảnh báo. Agent kết hợp các dữ liệu đó để giải thích và đề xuất bước tiếp theo.

## Vai trò của từng nguồn dữ liệu

### Dữ liệu ECU

ECU là nguồn chính để đánh giá tình trạng kỹ thuật của xe. Dữ liệu có thể gồm:

- Tốc độ xe.
- Vòng tua động cơ.
- Nhiệt độ nước làm mát.
- Tải động cơ.
- Điện áp hệ thống.
- Fuel trim, MAP, MAF và cảm biến oxy nếu có.
- Mã lỗi DTC.
- Thời gian vận hành liên tục.

ECU được dùng để phát hiện các hiện tượng như quá nhiệt, điện áp bất thường, RPM dao động hoặc dấu hiệu vận hành không ổn định. Trong MVP, dữ liệu này vẫn có thể được mô phỏng nhưng phải được ghi rõ là dữ liệu mô phỏng.

### Dữ liệu camera

Camera cung cấp các quan sát mà ECU không có. Trong MVP, camera tập trung vào trạng thái người lái:

- Có phát hiện khuôn mặt hay không.
- Mắt đang mở hay nhắm.
- Thời gian nhắm mắt liên tục.
- Hướng đầu và khả năng người lái đang nhìn về phía trước.
- Người lái có phản hồi sau cảnh báo hay không.

Camera chỉ nên tạo ra dữ liệu có cấu trúc, ví dụ:

```json
{
  "face_detected": true,
  "eyes_closed": true,
  "eyes_closed_seconds": 2.4,
  "head_direction": "down",
  "driver_attention": "low",
  "confidence": 0.87
}
```

Không gửi toàn bộ video cho agent theo từng khung hình. Module computer vision xử lý video trước, sau đó chỉ gửi sự kiện và các chỉ số cần thiết.

### Lịch sử bảo trì

Lịch sử bảo trì giúp agent đặt dữ liệu hiện tại vào bối cảnh:

- Xe đã từng gặp lỗi tương tự hay chưa.
- Bộ phận liên quan đã được thay hoặc sửa khi nào.
- Có hạng mục bảo trì nào đã quá hạn hay không.
- Những khuyến nghị trước đây đã được thực hiện chưa.

Lịch sử bảo trì không được dùng để khẳng định chắc chắn nguyên nhân hỏng hóc. Nó chỉ làm tăng hoặc giảm mức độ hợp lý của từng giả thuyết.

### Safety policy

Safety policy là tập hợp luật cố định và chạy độc lập với mô hình AI. Thành phần này chịu trách nhiệm:

- Phát hiện ngưỡng nguy hiểm.
- Phát cảnh báo tức thời.
- Quyết định mức độ sự cố.
- Chặn các khuyến nghị trái với nguyên tắc an toàn.
- Tiếp tục hoạt động khi agent hoặc kết nối Internet gặp lỗi.

Ví dụ, nếu nhiệt độ động cơ vượt ngưỡng nguy hiểm thì hệ thống phải yêu cầu dừng xe an toàn ngay. Agent không được phép thay đổi quyết định đó thành tiếp tục chạy đến garage.

### Vehicle Guardian Agent

Agent là lớp hợp nhất và giải thích dữ liệu. Agent có nhiệm vụ:

- Đọc sự kiện do safety policy tạo ra.
- Phân tích dữ liệu ECU và xu hướng theo thời gian.
- Tiếp nhận trạng thái người lái từ camera.
- Tra cứu lịch sử bảo trì khi cần.
- Giải thích các bằng chứng liên quan.
- Đề xuất hành động phù hợp với mức độ nguy hiểm và trạng thái người lái.
- Yêu cầu người dùng xác nhận trước các hành động có tác động bên ngoài.

Agent không trực tiếp đọc từng frame camera, điều khiển xe, vô hiệu hóa cảnh báo hoặc tự thực hiện hành động khẩn cấp.

## Tình huống sử dụng

### Người lái tỉnh táo và động cơ nóng nhẹ

ECU ghi nhận nhiệt độ nước làm mát đang tăng nhưng chưa vượt ngưỡng nguy hiểm. Camera cho thấy người lái đang chú ý và đã phản hồi cảnh báo.

Hệ thống có thể đề xuất:

> Nhiệt độ động cơ đang tăng và cần được theo dõi. Người lái đã xác nhận cảnh báo. Hãy giảm tải động cơ và đến garage phù hợp nếu nhiệt độ không tiếp tục tăng.

### Người lái mất tỉnh táo và động cơ nóng nhẹ

ECU ghi nhận nhiệt độ tăng ở mức cảnh báo. Camera phát hiện người lái nhắm mắt liên tục hoặc không phản hồi.

Agent thay đổi phương án vì người lái không còn phù hợp để tiếp tục hành trình dài:

> Nhiệt độ động cơ đang tăng nhưng chưa ở mức phải dừng khẩn cấp. Người lái có dấu hiệu mất tỉnh táo. Không nên tiếp tục đến garage cách xa; hãy dừng tại vị trí an toàn gần nhất để nghỉ và kiểm tra lại trạng thái xe.

### Động cơ quá nhiệt nghiêm trọng

ECU ghi nhận nhiệt độ đã vượt ngưỡng an toàn. Safety policy lập tức phát cảnh báo mức nghiêm trọng.

Trong tình huống này, trạng thái người lái không được làm thay đổi hành động bắt buộc:

> Hãy tấp vào vị trí an toàn gần nhất và tắt động cơ. Không tiếp tục đến trạm nghỉ hoặc garage. Không mở nắp két nước khi động cơ còn nóng.

### Người lái không phản hồi cảnh báo kỹ thuật

ECU phát hiện sự cố và hệ thống đã phát cảnh báo, nhưng camera không ghi nhận phản hồi của người lái.

Hệ thống sẽ:

1. Phát lại cảnh báo bằng âm thanh.
2. Hiển thị yêu cầu xác nhận rõ ràng.
3. Tăng mức cảnh báo nếu vẫn không có phản hồi.
4. Đề xuất dừng tại vị trí an toàn gần nhất.

MVP không tự gọi cứu hộ, gửi tin nhắn hoặc điều khiển xe. Những hành động này chỉ được xem xét ở giai đoạn sau và phải có sự đồng ý rõ ràng của người dùng.

### Camera không quan sát được người lái

Nếu ánh sáng yếu, khuôn mặt bị che hoặc camera bị lệch, trạng thái phải là `unknown` thay vì suy luận rằng người lái đang tỉnh táo.

Agent cần thông báo:

> Không thể xác định trạng thái người lái từ camera. Cảnh báo kỹ thuật của xe vẫn được duy trì theo dữ liệu ECU.

## Ranh giới an toàn

### Cảnh báo khẩn cấp không phụ thuộc vào agent

Các trường hợp như quá nhiệt nghiêm trọng hoặc điện áp nguy hiểm phải được xử lý bằng luật cố định. Còi và cảnh báo trên giao diện phải hoạt động kể cả khi mô hình AI không phản hồi.

### Agent không điều khiển xe

Agent không có quyền:

- Phanh, tăng ga hoặc đánh lái.
- Tắt động cơ từ xa.
- Can thiệp vào ECU.
- Xóa hoặc vô hiệu hóa cảnh báo.
- Khẳng định một bộ phận đã hỏng nếu chưa có đủ bằng chứng.

### Camera không được coi là bằng chứng tuyệt đối

Kết quả camera có thể sai do ánh sáng, kính mắt, góc quay hoặc khuôn mặt bị che. Mọi kết quả cần kèm độ tin cậy. Trạng thái không chắc chắn phải được ghi là `unknown`.

### Quyền riêng tư

- Ưu tiên xử lý camera ngay trên thiết bị.
- Không lưu video mặc định.
- Chỉ lưu sự kiện và chỉ số cần thiết.
- Nếu cần lưu ảnh phục vụ kiểm thử, phải thông báo và có sự đồng ý.
- Cho phép người dùng tắt camera bất cứ lúc nào.

### Phân biệt dữ liệu thật và dữ liệu mô phỏng

Dashboard và phần thuyết trình phải ghi rõ nguồn dữ liệu. Không trình bày ECU mô phỏng như dữ liệu lấy trực tiếp từ xe thật.

## MVP đề xuất

MVP chỉ cần chứng minh một vòng quyết định hoàn chỉnh. Không cần phát triển hệ thống giám sát tài xế toàn diện.

### Phạm vi bắt buộc

1. Webcam nhận diện khuôn mặt và trạng thái mắt.
2. Đếm thời gian nhắm mắt liên tục.
3. Phân biệt `attentive`, `low_attention` và `unknown`.
4. ECU simulator phát các kịch bản bình thường, nóng nhẹ và quá nhiệt.
5. Safety policy tạo cảnh báo theo luật cố định.
6. Agent nhận dữ liệu ECU, trạng thái camera và lịch sử bảo trì.
7. Agent đưa ra lời giải thích và đề xuất khác nhau theo từng bối cảnh.
8. Dashboard hiển thị nguồn dữ liệu, mức độ sự cố và lý do của đề xuất.

### Chưa làm trong MVP

- Điều khiển phương tiện.
- Gửi tin nhắn hoặc gọi cứu hộ tự động.
- Nhận diện sử dụng điện thoại, hút thuốc hoặc nhiều hành vi tài xế khác.
- Lưu video dài hạn.
- Chẩn đoán y tế về tình trạng người lái.
- Kết nối OBD-II hoặc ECU thật nếu chưa có phần cứng.

### Tiêu chí hoàn thành

MVP được xem là hoàn thành khi:

- Chớp mắt bình thường không kích hoạt cảnh báo.
- Nhắm mắt liên tục theo ngưỡng thử nghiệm tạo ra sự kiện camera.
- Cảnh báo quá nhiệt vẫn hoạt động khi tắt agent.
- Agent thay đổi đề xuất khi trạng thái người lái thay đổi.
- Agent không đề xuất tiếp tục chạy khi safety policy yêu cầu dừng.
- Giao diện ghi rõ dữ liệu ECU đang được mô phỏng.

## Kịch bản demo cho team

### Chuẩn bị

- Webcam hoạt động và đã kiểm tra ánh sáng.
- Có một video dự phòng nếu nhận diện trực tiếp thất bại.
- ECU simulator phát dữ liệu xe đang chạy và một cảnh báo kỹ thuật ở mức chưa bắt buộc dừng khẩn cấp.
- Còi cảnh báo có nút tắt nhanh.
- Dashboard hiển thị đồng thời dữ liệu ECU, camera, safety policy và phản hồi của agent.

### Tình huống duy nhất người lái buồn ngủ hoặc không tỉnh táo

ECU mô phỏng xe đang chạy với các dữ liệu sau:

```json
{
  "speed_kmh": 65,
  "coolant_temperature_c": 103,
  "engine_load_percent": 72,
  "driving_duration_minutes": 128,
  "vehicle_alert_level": "warning"
}
```

Người trình diễn ngồi trước webcam, sau đó nhắm mắt liên tục khoảng hai giây hoặc giữ trạng thái không phản hồi cảnh báo.

Luồng demo:

1. Camera phát hiện khuôn mặt và bắt đầu đếm thời gian nhắm mắt.
2. Chớp mắt bình thường không tạo cảnh báo.
3. Khi thời gian nhắm mắt vượt ngưỡng thử nghiệm, module camera tạo sự kiện `low_attention`.
4. Safety policy phát còi ngay vì xe đang chạy và người lái có dấu hiệu mất tỉnh táo.
5. Agent nhận đồng thời dữ liệu ECU, sự kiện camera và lịch sử bảo trì.
6. Agent giải thích rủi ro và đề xuất dừng tại vị trí an toàn gần nhất thay vì tiếp tục hành trình đến garage ở xa.
7. Khi người lái mở mắt và xác nhận, hệ thống ghi nhận phản hồi nhưng vẫn giữ cảnh báo kỹ thuật của xe để tiếp tục theo dõi.

Dashboard cần hiển thị rõ:

```text
Vehicle speed: 65 km/h
Coolant temperature: 103 C
Driver state: Low attention
Eyes closed duration: 2.1 s
Safety alert: Immediate driver warning
Agent recommendation: Stop at the nearest safe location
```

Lời giải thích mẫu của agent:

> Xe đang chạy ở tốc độ 65 km/h, nhiệt độ động cơ đang tăng ở mức cảnh báo và người lái có dấu hiệu mất tỉnh táo sau hơn hai giờ vận hành. Không nên tiếp tục đến garage ở xa. Hãy dừng tại vị trí an toàn gần nhất, nghỉ ngơi và kiểm tra lại nhiệt độ động cơ trước khi tiếp tục.

Điểm team cần nhấn mạnh khi trình bày:

- Còi được kích hoạt bởi safety policy, không chờ mô hình AI.
- Agent không phát hiện mắt nhắm trực tiếp; agent nhận sự kiện có cấu trúc từ module camera.
- ECU vẫn là nguồn mô tả tình trạng kỹ thuật và trạng thái vận hành của xe.
- Camera bổ sung trạng thái của người lái để agent điều chỉnh phương án xử lý.
- Agent chỉ giải thích và đề xuất, không điều khiển xe.
- Demo chỉ chứng minh một tình huống người lái buồn ngủ hoặc không tỉnh táo, không trình diễn các scenario khác.

## Số liệu thử nghiệm cần chuẩn bị

Team nên tự quay một bộ thử nghiệm nhỏ và công bố trung thực:

- Số lần thử khi mắt mở.
- Số lần chớp mắt bình thường.
- Số lần nhắm mắt liên tục theo ngưỡng.
- Kết quả khi đeo kính thường.
- Kết quả trong ánh sáng yếu.
- Tỉ lệ báo nhầm.
- Độ trễ trung bình từ khi nhắm mắt đến khi cảnh báo.

Không gọi đây là kết quả kiểm định an toàn. Đây chỉ là số liệu đánh giá prototype trong điều kiện thử nghiệm của team.

## Thông điệp chung cho team

Camera không phải tính năng đứng riêng và không thay thế agent ECU. Camera mở rộng ngữ cảnh mà agent có thể sử dụng. ECU vẫn tạo ra tình huống kỹ thuật, safety policy vẫn quyết định cảnh báo bắt buộc, còn agent giải thích và lựa chọn phương án phù hợp với cả tình trạng xe lẫn khả năng phản hồi của người lái.
