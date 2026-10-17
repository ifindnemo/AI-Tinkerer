---
name: chan-doan-dong-co
description: Chẩn đoán và định hướng sửa chữa quá nhiệt, lỗi làm mát, mã lỗi OBD, điện áp ắc quy/sạc, hỗn hợp giàu/nghèo, bỏ máy và bất thường đường nạp của động cơ xăng. Dùng để đối chiếu ngưỡng, diễn giải dữ liệu cảm biến và các luật của backend, khoanh vùng nguyên nhân và chọn phép kiểm tra xác nhận.
---

# Chẩn đoán và sửa chữa động cơ xăng

## Phạm vi và cơ sở chẩn đoán

Chuyên môn nạp khí, nhiên liệu, đốt cháy, làm mát, bôi trơn và điện của động cơ xăng. Dữ liệu đầu vào là toàn bộ batch ECU đã được backend kiểm tra schema và đưa thẳng vào agent; không có bước dự đoán ML trung gian. Có hai loại nguồn: thiết bị OBD-II (nhiệt độ nước làm mát, tốc độ, RPM, tải máy, điện áp, mã lỗi; mỗi xe chỉ có một phần các tín hiệu này) và bộ dữ liệu đầy đủ kèm khí thải, Lambda, MAP/TPS. Chỉ dùng các tín hiệu có trong record; tín hiệu vắng mặt ghi vào missing_data, không suy đoán.

Đọc các record theo thứ tự thời gian và đối chiếu trực tiếp các trường có mặt. Không tái tạo trường `Fault`, không tự bịa đơn vị hoặc thông số còn thiếu, và không coi giá trị dẫn xuất là phép đo độc lập với các đầu vào tạo ra nó. Dùng các ngưỡng tham chiếu dưới đây để diễn giải số đo, xu hướng và tương quan; không tự đặt thêm ngưỡng ngoài skill hoặc hard safety guardrail của backend. Các mô tả “ổn định”, “dao động bất thường” và “kéo dài” phải dựa trên nhiều record trong batch và đúng điều kiện vận hành.

Phân biệt trạng thái hỗn hợp với lỗi: hỗn hợp giàu hoặc nghèo chỉ trở thành dấu hiệu hư hỏng khi không phù hợp với chế độ vận hành. Kết luận linh kiện hỏng cần phép kiểm tra xác nhận.

## Ý nghĩa các thông số

| Thông số | Vai trò trong chẩn đoán |
|---|---|
| MAP | Áp suất tuyệt đối đường nạp; đánh giá trạng thái nạp cùng bướm ga, tốc độ động cơ và loại động cơ |
| TPS / RPM | Vị trí bướm ga / tốc độ động cơ; nhận diện điều kiện vận hành và phản ứng đường nạp |
| O2 narrowband zirconia | Điện áp phản ánh phía giàu hoặc nghèo quanh vùng stoichiometric; không phải nồng độ oxy khí thải |
| O2 wideband / Lambda / AFR | Phản ánh trạng thái hỗn hợp; chú ý các giá trị có thể cùng nguồn cảm biến |
| O2 khí thải | Nồng độ oxy còn lại; oxy cao có thể liên quan hỗn hợp nghèo, bỏ máy hoặc lọt khí đường xả |
| CO / HC / CO2 | Phản ánh cháy không hoàn toàn, nhiên liệu chưa cháy và sản phẩm cháy; diễn giải theo vị trí lấy mẫu và trạng thái xúc tác |
| Power / Fuel Consumption | Công suất / tiêu hao nhiên liệu; record chỉ có giá trị đo, không có giá trị kỳ vọng đi kèm, nên so sánh xu hướng ở cùng điều kiện vận hành |
| ECT | Nhiệt độ nước làm mát động cơ; nhận diện làm ấm, điều hòa nhiệt và quá nhiệt |
| Điện áp ắc quy | Tình trạng ắc quy và hệ thống sạc; khi nổ máy thường cao hơn lúc tắt máy |
| Mã lỗi (DTC), đèn MIL | Mã đã lưu (stored) là lỗi đã xác nhận bởi ECU; mã đang chờ (pending) mới thấy một lần; MIL bật báo ECU có lỗi ảnh hưởng khí thải |
| EOT | Nhiệt độ dầu bôi trơn động cơ; đánh giá trạng thái nhiệt của dầu, không thay thế mức dầu hoặc áp suất dầu |

## Ngưỡng tham chiếu

Ưu tiên giới hạn kỹ thuật của đúng động cơ, nhiên liệu, vị trí đo và chế độ vận hành. Các luật của backend (mục “Luật và mốc của backend”) là mốc bắt buộc của sản phẩm và cao hơn mọi mốc sàng lọc dưới đây. Phân biệt khoảng điển hình có nguồn với mốc sàng lọc kinh nghiệm. Vượt mốc sàng lọc chỉ gợi ý cần đối chiếu thêm; không tự xác nhận linh kiện hỏng hoặc xe không đạt kiểm định.

### Lambda và AFR

Lambda stoichiometric là `1.00`. Bảng dưới giữ các mốc sàng lọc rộng; “gần stoichiometric” không có nghĩa mọi xe đều chấp nhận sai lệch đó khi chạy vòng kín. Mục tiêu hỗn hợp của chế độ vận hành có ưu tiên cao hơn bảng.

| Phân loại sàng lọc | Lambda | AFR khi chuẩn stoichiometric của nhiên liệu là 14.7 |
|---|---|---|
| Giàu rõ | `< 0.90` | `< 13.23` |
| Giàu | `>= 0.90` và `< 0.95` | `>= 13.23` và `< 13.965` |
| Gần stoichiometric | `>= 0.95` và `<= 1.05` | `>= 13.965` và `<= 15.435` |
| Nghèo | `> 1.05` và `<= 1.10` | `> 15.435` và `<= 16.17` |
| Nghèo rõ | `> 1.10` | `> 16.17` |

Đọc Lambda/AFR đo được, theo đúng nhiên liệu của xe. Không áp cột AFR này cho nhiên liệu có chuẩn stoichiometric khác. Không gán lỗi từ hướng giàu/nghèo trong chế độ làm giàu chủ động hoặc cắt nhiên liệu.

### Điện áp O2 narrowband zirconia

| Điện áp | Diễn giải sàng lọc |
|---|---|
| `<= 0.20 V` | Phía nghèo hoặc oxy dư |
| `> 0.20 V` và `< 0.80 V` | Vùng chuyển tiếp; không kết luận từ một mẫu |
| `>= 0.80 V` | Phía giàu hoặc oxy dư thấp |

Các mốc trên phân vùng điện áp; không phải điều kiện xác nhận cảm biến hỏng. Tín hiệu chuyển mạch điển hình có thể dao động khoảng `0.1–0.9 V` khi đủ điều kiện làm việc. Không áp bảng này cho wideband, cảm biến titania hoặc nồng độ O2 khí thải.

### Khí thải ở không tải, động cơ và xúc tác làm việc bình thường

| Chỉ số | Khoảng điển hình tham khảo của Walker |
|---|---|
| CO2 | `14.5–16%` thể tích |
| O2 khí thải | `0–0.35%` thể tích |
| CO | `0.10–0.45%` thể tích |
| HC | `0–35 ppm` |
| Lambda | `0.995–1.005` |

Đây là khoảng điển hình tại không tải cho động cơ và xúc tác hoạt động bình thường, không phải bảng áp dụng cho mọi tải hoặc mẫu trước xúc tác. Giá trị ngoài khoảng cần đối chiếu hỗn hợp, xúc tác và điều kiện lấy mẫu. CO thấp hơn khoảng điển hình không tự biểu thị lỗi.

### Đường nạp và công suất

Các mốc là sàng lọc kinh nghiệm, chưa phải giới hạn đã hiệu chuẩn cho từng xe.

| Chỉ số | Mốc tham chiếu | Điều kiện và ý nghĩa |
|---|---|---|
| RPM không tải | `600–1000 vòng/phút` | Khoảng thường gặp ở động cơ xăng đã nóng; tốc độ mục tiêu của xe có ưu tiên cao hơn |

MAP, công suất và tiêu hao trong record là giá trị đo tuyệt đối, không có tỉ lệ so với giá trị kỳ vọng. Không tự tính tỉ lệ, không tự đặt mốc sai lệch Lambda–AFR, độ tăng MAP theo TPS hay thời gian kẹt O2 để kết luận lỗi; chỉ nhận xét xu hướng và tương quan giữa các tín hiệu cùng điều kiện vận hành.

### ECT và EOT

| Thông số | Mốc áp dụng | Diễn giải |
|---|---|---|
| ECT | Giới hạn nhiệt độ làm việc, cảnh báo và nguy hiểm của đúng động cơ | Dùng số đo và các luật nhiệt của backend ở mục dưới; không dùng điểm mở van hay bật quạt làm ngưỡng quá nhiệt |
| EOT | Giới hạn nhiệt độ dầu của đúng động cơ và điều kiện tải | Không dùng ngưỡng ECT để đánh giá EOT |
| EOT — ví dụ có phạm vi xác định | `80–120°C` cho các xe Audi 3.0 TFSI liệt kê trong TSB 2054893/3 | Khoảng nhiệt độ làm việc của nhóm xe đó; không phải ngưỡng quá nhiệt chung |

Skill không đặt một con số cảnh báo ECT/EOT chung cho mọi xe. Xu hướng tăng nhiệt lấy từ các record theo thứ tự thời gian và từ detector_findings (R1, R2); không tự tính lại tốc độ tăng.

## Luật và mốc của backend (dữ liệu OBD)

Backend chạy các luật xác định trước khi agent trả lời. Kết quả nằm trong `hard_safety_guardrail` và `detector_findings`; trích dẫn số liệu trong đó, không đặt mốc khác và không hạ mức đã được luật đặt.

| Luật | Điều kiện | Mức tối thiểu |
|---|---|---|
| An toàn cứng | ECT `>= 120°C`, hoặc mã P0217 đã lưu | critical |
| An toàn cứng | Mã bỏ máy P0300–P0308 đã lưu; điện áp `<= 10.5 V` hoặc `>= 15.5 V` | warning |
| R1 | ECT `>= 105°C` liên tục từ 20 giây (mốc cảnh báo sớm của sản phẩm, chỉnh được theo từng xe) | warning |
| R2 | ECT trên 95°C và tăng quá 3°C/phút trong ít nhất 30 giây trong khi tải máy gần như không tăng | không có; gợi ý tản nhiệt kém |
| R3 | Có mã lỗi hoặc đèn MIL bật | chỉ mã đã lưu mới có sàn ở trên |
| R4 | Điện áp `< 12.0 V` khi đang nổ máy, hoặc `> 15.2 V`, kéo dài 30 giây | không có; nghi ắc quy hoặc hệ thống sạc |
| R5 | ECT đứng yên đúng một giá trị suốt 10 phút khi xe đang chạy | không có; nghi cảm biến, không phải quá nhiệt |

Các luật chỉ đặt mức tối thiểu, không phải điều kiện cần. Sản phẩm chọn cảnh báo sớm ở 105°C: khi ECT đã chạm hoặc vượt 105°C và vẫn đang tăng, dù chưa đủ 20 giây để R1 báo, đánh giá warning chứ không normal; nói rõ nhiệt độ vừa vượt mốc và cần theo dõi.

Mã lỗi: dùng `knowledge` và `freeze_frames` trong `dtc_snapshot`. Mã đã lưu có trọng lượng hơn mã đang chờ; MIL bật không tự nghĩa là nguy hiểm. P0217 là quá nhiệt; P0300 là bỏ máy ngẫu nhiên, P0301–P0308 chỉ xy-lanh tương ứng. Mã không có trong `knowledge` thì nói cần máy chẩn đoán của hãng và không đoán. Không bao giờ khuyên xóa mã hay tắt đèn check engine trước khi garage sửa xong.

Điện áp: một số đo thấp hoặc cao chưa đủ kết luận máy phát hay ắc quy hỏng. Đối chiếu điện áp khi nổ máy và khi tắt máy, tải điện đang bật và RPM; để garage đo ắc quy và dòng sạc.

Nhiệt độ: ECT đứng yên đúng một giá trị (R5) và ECT tăng nhanh (R2) có nguyên nhân khác nhau. R5 gợi ý cảm biến hoặc mạch đo, R2 gợi ý làm mát kém. Quá nhiệt nghiêm trọng chỉ khi ECT đã vượt mốc nguy hiểm ở trên.

## Điều kiện cần xét trước khi khoanh vùng

- Phân biệt máy lạnh, làm ấm, không tải, chạy đều, tăng tốc, mở hết ga và giảm tốc cắt nhiên liệu.
- Xét trạng thái vòng kín/vòng hở, mục tiêu hỗn hợp, điều khiển tăng áp và chế độ bảo vệ động cơ.
- Phân biệt vị trí trước/sau xúc tác của cảm biến O2 và mẫu khí thải.
- Đối chiếu các tín hiệu thuộc cùng sự kiện vận hành sau khi đã xét độ trễ. Không coi lệch thời điểm phản hồi là lỗi cảm biến.
- Lambda và AFR cùng một cảm biến không phải các bằng chứng xác nhận độc lập. Tương tự, công suất ước tính từ MAP/RPM không phải phép đo cơ học độc lập với MAP/RPM.

Cắt nhiên liệu khi giảm tốc là một chế độ điều khiển; không gán các dấu hiệu của chế độ này thành lỗi cấp nhiên liệu hoặc bỏ máy.

## Diễn giải O2 và hỗn hợp

| Dạng tín hiệu | Phía giàu | Phía nghèo hoặc oxy dư |
|---|---|---|
| Điện áp O2 narrowband zirconia | Điện áp cao | Điện áp thấp |
| Lambda/AFR từ wideband | Trạng thái giàu đã được xác định theo nhiên liệu | Trạng thái nghèo đã được xác định theo nhiên liệu |
| Nồng độ O2 khí thải | Thường thấp | Thường cao |

Luôn gọi đúng tên dạng tín hiệu. Không dùng cụm “O2 cao” hoặc “O2 thấp” mà không phân biệt điện áp với nồng độ.

Narrowband trước xúc tác có thể chuyển giàu–nghèo trong điều khiển vòng kín bình thường. Dao động này không tự chứng minh bỏ máy. Không yêu cầu cảm biến sau xúc tác có cùng dạng dao động với cảm biến trước xúc tác; cảm biến sau xúc tác có vai trò giám sát bộ xúc tác.

Không kết luận hỏng cảm biến chỉ vì tín hiệu đứng ở phía giàu hoặc nghèo. Trước tiên phân biệt hỗn hợp thực, chế độ điều khiển và phản ứng của cảm biến.

## Đường nạp: MAP, TPS và RPM

Trên động cơ hút khí tự nhiên, MAP thường thấp khi bướm ga đóng và tiến gần áp suất khí quyển khi mở ga. Khi MAP đã gần áp suất khí quyển, mở thêm bướm ga có thể chỉ làm MAP thay đổi ít; đây không tự động là lỗi.

Quan hệ TPS–MAP không tuyến tính và còn phụ thuộc RPM, tải, phối khí và điều khiển bướm ga. Chỉ nghi bất thường đường nạp khi phản ứng đã được đánh giá không phù hợp với các điều kiện này. Không áp quy luật hút khí tự nhiên cho động cơ tăng áp.

Với speed-density, MAP có thể phản ánh tác động của khí rò vào cổ hút. Không coi mọi rò rỉ chân không là lượng khí hoàn toàn không được MAP nhận biết.

## Khoanh vùng hỗn hợp và cháy không hoàn toàn

| Mẫu dấu hiệu đã đánh giá | Hướng chẩn đoán | Điều kiện phân biệt |
|---|---|---|
| Hỗn hợp giàu ngoài mục tiêu; CO tăng; nồng độ O2 khí thải thấp hoặc điện áp narrowband zirconia cao | Nghi cấp dư nhiên liệu hoặc phản hồi điều khiển sai | Xét chế độ làm ấm, làm giàu chủ động và ECT trước khi quy cho injector |
| Hỗn hợp nghèo ngoài mục tiêu; nồng độ O2 khí thải cao hoặc điện áp narrowband zirconia thấp; CO thấp | Nghi cấp thiếu nhiên liệu hoặc bất thường khí nạp | Loại trừ cắt nhiên liệu chủ động, bỏ máy và lọt khí đường xả |
| HC tăng bất thường cùng nồng độ O2 khí thải tăng, kèm cháy không đều hoặc hụt công suất | Nghi bỏ máy/cháy không hoàn toàn | Xét đánh lửa, độ nén, injector; không dùng Lambda dao động làm điều kiện bắt buộc |
| Dấu hiệu nghèo nặng hơn ở không tải, cải thiện ở điều kiện tải so sánh được | Củng cố nghi rò rỉ chân không | Chỉ so khi mục tiêu hỗn hợp và trạng thái điều khiển tương thích |
| Hụt công suất nhưng không có bằng chứng hỗn hợp hoặc cháy bất thường tương ứng | Mở rộng kiểm tra điều khiển mô-men, nhiệt và đường nạp | Không đồng nhất hụt công suất với bỏ máy |
| Tiêu hao không tương xứng với công suất | Nghi hiệu suất vận hành suy giảm | Chỉ hỗ trợ chẩn đoán, không tự phân biệt giàu, nghèo hay bỏ máy |
| Các tín hiệu phản ánh hỗn hợp mâu thuẫn nhau | Nghi sai lệch cảm biến, vị trí đo, phản hồi quá độ hoặc ảnh hưởng đường xả | Kiểm tra điều kiện đo trước khi thay linh kiện |

HC tăng không phải điều kiện bắt buộc của hỗn hợp giàu; CO cũng không bắt buộc tăng trong mọi dạng bỏ máy. Xúc tác có thể làm thay đổi hoặc che bớt dấu hiệu khí thải, nên số đo sau xúc tác không phải bằng chứng trực tiếp về từng xy-lanh.

CO2 thấp có thể liên quan cháy kém hoặc khí thải bị pha loãng; không tự xác nhận bỏ máy. Hỗn hợp nghèo và bỏ máy có thể cùng tồn tại, không bắt buộc chọn một trong hai.

## Nhiệt độ nước làm mát và dầu

Ưu tiên xử lý trạng thái quá nhiệt nguy hiểm trước khi thử tải. Phân biệt quá trình làm ấm bình thường với nhiệt độ thấp kéo dài bất thường.

| Mẫu trạng thái nhiệt | Hướng khoanh vùng |
|---|---|
| ECT tăng bất thường khi đứng yên/chạy chậm, cải thiện khi xe chạy | Kiểm tra quạt và luồng gió qua két nước; tăng RPM tại chỗ không tương đương xe chạy |
| ECT quá nóng qua các điều kiện tải | Kiểm tra mức nước, rò rỉ, van hằng nhiệt, két nước, bơm nước và nắp áp suất |
| ECT chậm đạt nhiệt độ làm việc hoặc thấp bất thường sau giai đoạn làm ấm | Kiểm tra van hằng nhiệt kẹt mở và tính hợp lý của phép đo |
| EOT quá nóng trong khi ECT còn phù hợp | Kiểm tra điều kiện tải, mức/loại dầu và bộ làm mát dầu |
| ECT và EOT cùng quá nóng | Kiểm tra khả năng tản nhiệt chung và điều kiện tải |
| ECT hoặc EOT có dạng biến đổi không hợp lý | Kiểm tra cảm biến, giắc và mạch điện; không chỉ dựa vào một kênh nhiệt để kết luận hỏng cơ khí |

Các mẫu nhiệt là hướng khoanh vùng, không xác nhận riêng một linh kiện. Điểm mở van hằng nhiệt, điểm kích hoạt quạt và trạng thái quá nhiệt có ý nghĩa khác nhau. Áp suất và thành phần dung dịch ảnh hưởng điểm sôi của nước làm mát.

ECT ảnh hưởng điều khiển nhiên liệu. Máy đang làm ấm hoặc ECT báo sai có thể đi kèm hỗn hợp giàu và tiêu hao tăng; cần phân biệt trước khi quy cho injector rò.

Quá nhiệt có thể kích hoạt giảm công suất hoặc ngắt phun có chủ đích. Không quy các biểu hiện này thành bỏ máy do hư hỏng khi chưa phân biệt được chế độ bảo vệ.

EOT không cho biết trực tiếp mức dầu hoặc áp suất dầu. EOT quá nóng không tự chứng minh thiếu dầu hay hỏng bơm dầu; EOT phù hợp không loại trừ lỗi áp suất bôi trơn.

## Mức kết luận chuyên môn

- Nghi vấn: dấu hiệu phù hợp một nhóm nguyên nhân nhưng còn cách giải thích khác.
- Được củng cố: các bằng chứng khác nguồn cùng phù hợp và đã xét những nguyên nhân thay thế liên quan.
- Đã xác nhận: phép kiểm tra trực tiếp chứng minh bộ phận hoặc cơ chế lỗi.

Không nâng một nghi vấn thành lỗi đã xác nhận bằng cách đếm cảm biến hoặc gán phần trăm tin cậy. Bằng chứng mâu thuẫn cần được giải thích. Phân biệt rõ tình trạng đã quan sát được với nguyên nhân đang nghi ngờ.

## Kiểm tra xác nhận và hướng sửa chữa

| Nhóm lỗi | Kiểm tra xác nhận | Hướng xử lý sau xác nhận |
|---|---|---|
| Rò rỉ chân không | Smoke test; kiểm tra ống chân không, gioăng cổ hút và PCV | Khắc phục điểm rò, sửa hoặc thay chi tiết hư hỏng |
| Hỗn hợp giàu | Kiểm tra áp suất nhiên liệu, độ kín injector và phản ứng cảm biến liên quan | Xử lý nguyên nhân gây dư nhiên liệu hoặc phản hồi sai |
| Hỗn hợp nghèo | Kiểm tra rò đường nạp/xả, áp suất nhiên liệu và khả năng cấp nhiên liệu của injector | Khắc phục khí lọt hoặc bộ phận cấp nhiên liệu không đạt yêu cầu |
| Bỏ máy/cháy không hoàn toàn | Kiểm tra đánh lửa, độ nén và injector để khoanh vùng xy-lanh | Sửa lỗi đánh lửa, cơ khí hoặc phun nhiên liệu đã xác nhận |
| MAP/TPS không hợp lý | Kiểm tra bướm ga, đường nạp và cảm biến trong đúng chế độ vận hành | Xử lý chỗ tắc, lỗi bướm ga hoặc cảm biến |
| ECT quá nóng, nghi thiếu gió | Kiểm tra quạt, mạch điện và mặt két | Sửa quạt/mạch lỗi hoặc khắc phục cản gió |
| ECT quá nóng, nghi tuần hoàn nước kém | Kiểm tra rò, nắp áp suất, van hằng nhiệt, két và bơm nước | Sửa chi tiết lỗi, nạp đúng dung dịch và xả khí theo quy trình của xe |
| ECT thấp bất thường | Kiểm tra cảm biến và hoạt động van hằng nhiệt | Thay van kẹt mở hoặc sửa lỗi phép đo đã xác nhận |
| EOT quá nóng | Kiểm tra mức/loại dầu, bộ làm mát dầu và áp suất bôi trơn | Khắc phục nguyên nhân đã xác nhận; không thay bơm dầu chỉ từ EOT |
| Điện áp thấp hoặc cao | Đo ắc quy khi tắt máy, điện áp và dòng sạc khi nổ máy, dây và giắc nối | Sửa ắc quy, máy phát hoặc mạch đã xác nhận; không thay linh kiện chỉ từ một số đo |
| ECT đứng yên một giá trị (R5) | Đối chiếu bằng máy đo nhiệt ngoài hoặc dữ liệu từ cảm biến khác, kiểm tra giắc và mạch cảm biến | Thay cảm biến hoặc sửa mạch đã xác nhận |

Các kiểm tra quạt, van hằng nhiệt, bơm, két và nắp áp suất theo quy trình của hãng xe và nhà sản xuất linh kiện.

Khi có cảnh báo quá nhiệt nghiêm trọng, dừng xe an toàn và xử lý theo hướng dẫn của xe; không tiếp tục thử tải. Không mở nắp két hoặc bình nước làm mát khi còn nóng hay có áp suất. Khi có cảnh báo áp suất dầu thấp, dừng máy ngay khi an toàn, bất kể EOT.

Sau sửa chữa, kiểm tra lại ở điều kiện tương đương lúc xuất hiện lỗi. Xác nhận triệu chứng không tái xuất hiện, trạng thái hỗn hợp và khí thải phù hợp, công suất/tiêu hao trở về mức kỳ vọng. Với lỗi nhiệt, kiểm tra quá trình làm ấm, ECT/EOT và hoạt động quạt; chỉ thử tải khi trạng thái nhiệt cho phép.

Nguồn tham khảo cho các mốc và nguyên lý trên: HELLA (cảm biến Lambda, hệ thống làm mát), Walker (bảng chẩn đoán khí thải), Ford (giám sát OBD, chế độ bảo vệ làm mát, nhiệt độ và áp suất dầu), Pico Technology (kiểm tra MAP), Audi TSB 2054893/3 (nhiệt độ dầu).
