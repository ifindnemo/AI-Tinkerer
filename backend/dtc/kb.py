"""Vietnamese explanations for common generic (SAE J2012) powertrain DTCs.

Written for drivers: what the code means, how urgent it is, and what a garage
will check. Codes not listed here are never guessed: the explanation says a
manufacturer scan tool or a technician is needed.
"""

import re
from dataclasses import asdict, dataclass

DTC_PATTERN = re.compile(r"^[PCBU][0-3][0-9A-F]{3}$")

# Urgency for the driver: critical = stop safely, warning = check soon, info = check at the next service.
URGENCY_LABELS = {
    "critical": "Nguy hiểm: dừng xe ở nơi an toàn",
    "warning": "Nên kiểm tra sớm",
    "info": "Kiểm tra trong lần bảo dưỡng tới",
}
UNKNOWN_ADVICE = "cần máy chẩn đoán của hãng hoặc kỹ thuật viên để đọc đúng ý nghĩa"


@dataclass(frozen=True)
class DtcInfo:
    code: str
    system: str
    urgency: str
    title: str
    meaning: str
    causes: tuple[str, ...]
    checks: tuple[str, ...]
    advice: str


def _entry(code, system, urgency, title, meaning, causes, checks, advice) -> DtcInfo:
    return DtcInfo(code, system, urgency, title, meaning, tuple(causes), tuple(checks), advice)


_ENTRIES: list[DtcInfo] = [
    # ---- Làm mát -----------------------------------------------------------
    _entry("P0115", "Làm mát", "warning", "Lỗi mạch cảm biến nhiệt độ nước làm mát",
           "ECU nhận tín hiệu bất thường từ cảm biến nhiệt độ nước làm mát (ECT), nên không theo dõi chính xác được nhiệt độ máy.",
           ["Cảm biến ECT hỏng", "Giắc cắm lỏng hoặc oxy hóa", "Dây tín hiệu đứt hoặc chạm mát"],
           ["Đọc giá trị ECT trực tiếp và so với nhiệt độ thực của máy", "Đo điện trở cảm biến", "Kiểm tra giắc và dây dẫn"],
           "Theo dõi đồng hồ nhiệt trên taplo; nếu thấy dấu hiệu nóng máy thì dừng xe."),
    _entry("P0116", "Làm mát", "warning", "Cảm biến nhiệt độ nước làm mát đọc sai khoảng",
           "Giá trị cảm biến ECT không hợp lý so với thời gian máy chạy hoặc các cảm biến nhiệt khác.",
           ["Cảm biến ECT trôi giá trị", "Van hằng nhiệt kẹt", "Thiếu nước làm mát"],
           ["So ECT với nhiệt độ khí nạp khi máy nguội", "Kiểm tra mức nước làm mát", "Kiểm tra van hằng nhiệt"],
           "Kiểm tra mức nước làm mát khi máy đã nguội và theo dõi nhiệt độ."),
    _entry("P0117", "Làm mát", "warning", "Tín hiệu cảm biến nhiệt độ nước làm mát quá thấp",
           "Điện áp cảm biến ECT thấp bất thường, ECU hiểu là máy rất nóng hoặc mạch bị chạm mát.",
           ["Dây tín hiệu chạm mát", "Cảm biến ECT hỏng"],
           ["Đo điện áp tín hiệu ECT", "Kiểm tra dây và giắc cảm biến"],
           "Nên kiểm tra sớm; quạt két nước có thể chạy liên tục."),
    _entry("P0118", "Làm mát", "warning", "Tín hiệu cảm biến nhiệt độ nước làm mát quá cao",
           "Điện áp cảm biến ECT cao bất thường, thường do hở mạch; ECU có thể hiểu máy đang rất lạnh.",
           ["Giắc cảm biến tuột", "Dây tín hiệu đứt", "Cảm biến ECT hỏng"],
           ["Đo điện áp và điện trở cảm biến ECT", "Kiểm tra giắc và dây dẫn"],
           "Nên kiểm tra sớm; xe có thể tốn xăng và khó khởi động."),
    _entry("P0119", "Làm mát", "warning", "Tín hiệu cảm biến nhiệt độ nước làm mát chập chờn",
           "Tín hiệu ECT lúc có lúc mất, thường do tiếp xúc kém.",
           ["Giắc cắm lỏng", "Dây dẫn bị cọ xát", "Cảm biến ECT hỏng"],
           ["Lắc nhẹ giắc và dây khi theo dõi giá trị ECT", "Kiểm tra giắc cảm biến"],
           "Theo dõi đồng hồ nhiệt trên taplo và kiểm tra sớm."),
    _entry("P0125", "Làm mát", "info", "Nhiệt độ nước làm mát chưa đủ để điều khiển nhiên liệu vòng kín",
           "Máy mất quá lâu mới đạt nhiệt độ làm việc, nên ECU chậm chuyển sang chế độ điều khiển nhiên liệu chính xác.",
           ["Van hằng nhiệt kẹt mở", "Cảm biến ECT đọc thấp", "Thiếu nước làm mát"],
           ["Theo dõi thời gian máy đạt nhiệt độ làm việc", "Kiểm tra van hằng nhiệt", "Kiểm tra mức nước làm mát"],
           "Không nguy hiểm tức thì; kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0128", "Làm mát", "info", "Nhiệt độ nước làm mát thấp hơn mức van hằng nhiệt điều chỉnh",
           "Máy chạy nguội hơn bình thường, thường do van hằng nhiệt mở quá sớm.",
           ["Van hằng nhiệt kẹt mở", "Cảm biến ECT đọc thấp", "Quạt két nước chạy liên tục"],
           ["Kiểm tra van hằng nhiệt", "Kiểm tra cảm biến ECT", "Kiểm tra điều khiển quạt két nước"],
           "Không nguy hiểm tức thì; xe có thể tốn xăng hơn. Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0217", "Làm mát", "critical", "Động cơ quá nhiệt",
           "ECU ghi nhận nhiệt độ động cơ vượt ngưỡng an toàn. Tiếp tục chạy có thể làm cong mặt máy hoặc hỏng gioăng quy-lát.",
           ["Thiếu nước làm mát hoặc rò rỉ", "Quạt két nước không chạy", "Bơm nước hỏng", "Van hằng nhiệt kẹt đóng", "Két nước bị tắc"],
           ["Kiểm tra mức và rò rỉ nước làm mát", "Kiểm tra quạt két nước và rơ-le quạt", "Kiểm tra bơm nước và van hằng nhiệt", "Thử áp suất hệ thống làm mát"],
           "Dừng xe ở nơi an toàn, tắt máy và để máy nguội. Không mở nắp két nước khi máy còn nóng."),
    _entry("P0480", "Làm mát", "warning", "Lỗi mạch điều khiển quạt làm mát 1",
           "ECU phát hiện mạch điều khiển quạt két nước bất thường; quạt có thể không chạy khi máy nóng.",
           ["Rơ-le quạt hỏng", "Cầu chì quạt đứt", "Mô-tơ quạt hỏng", "Dây điều khiển đứt"],
           ["Kích quạt bằng máy chẩn đoán", "Kiểm tra rơ-le, cầu chì và mô-tơ quạt"],
           "Theo dõi nhiệt độ máy, nhất là khi kẹt xe; nếu nhiệt tăng thì dừng xe."),
    # ---- Khí nạp và cảm biến -------------------------------------------------
    _entry("P0100", "Khí nạp", "warning", "Lỗi mạch cảm biến lưu lượng khí nạp (MAF)",
           "ECU nhận tín hiệu MAF bất thường nên tính sai lượng nhiên liệu cần phun.",
           ["Cảm biến MAF bẩn hoặc hỏng", "Giắc hoặc dây dẫn hỏng"],
           ["Đọc giá trị MAF khi nổ máy cầm chừng", "Kiểm tra giắc và dây", "Vệ sinh hoặc thay cảm biến MAF"],
           "Xe có thể yếu hoặc giật; nên kiểm tra sớm."),
    _entry("P0101", "Khí nạp", "warning", "Cảm biến MAF đọc sai khoảng",
           "Lưu lượng khí MAF đo được không khớp với vòng tua và tải máy.",
           ["Cảm biến MAF bẩn", "Rò rỉ khí nạp sau MAF", "Lọc gió quá bẩn"],
           ["Kiểm tra rò rỉ đường nạp", "Kiểm tra lọc gió", "Vệ sinh hoặc thay cảm biến MAF"],
           "Nên kiểm tra sớm để tránh tốn xăng."),
    _entry("P0102", "Khí nạp", "warning", "Tín hiệu cảm biến MAF quá thấp",
           "Điện áp hoặc tần số tín hiệu MAF thấp bất thường.",
           ["Giắc MAF lỏng", "Dây tín hiệu đứt", "Cảm biến MAF hỏng", "Rò rỉ khí nạp lớn"],
           ["Đo tín hiệu MAF", "Kiểm tra giắc, dây và đường ống nạp"],
           "Xe có thể yếu; nên kiểm tra sớm."),
    _entry("P0103", "Khí nạp", "warning", "Tín hiệu cảm biến MAF quá cao",
           "Điện áp hoặc tần số tín hiệu MAF cao bất thường.",
           ["Dây tín hiệu chạm nguồn", "Cảm biến MAF hỏng"],
           ["Đo tín hiệu MAF", "Kiểm tra dây và giắc cảm biến"],
           "Nên kiểm tra sớm."),
    _entry("P0105", "Khí nạp", "warning", "Lỗi mạch cảm biến áp suất đường nạp (MAP)",
           "ECU nhận tín hiệu MAP bất thường nên tính sai tải và nhiên liệu.",
           ["Cảm biến MAP hỏng", "Ống chân không nứt hoặc tuột", "Giắc hoặc dây hỏng"],
           ["Đọc giá trị MAP khi tắt máy và khi cầm chừng", "Kiểm tra ống chân không", "Kiểm tra giắc và dây"],
           "Nên kiểm tra sớm."),
    _entry("P0106", "Khí nạp", "warning", "Cảm biến MAP đọc sai khoảng",
           "Giá trị MAP không khớp với vòng tua và vị trí bướm ga.",
           ["Rò rỉ chân không", "Cảm biến MAP trôi giá trị"],
           ["Kiểm tra rò rỉ chân không", "So sánh MAP với áp suất khí quyển khi tắt máy"],
           "Nên kiểm tra sớm."),
    _entry("P0107", "Khí nạp", "warning", "Tín hiệu cảm biến MAP quá thấp",
           "Điện áp tín hiệu MAP thấp bất thường.",
           ["Dây tín hiệu chạm mát", "Mất nguồn 5 V cảm biến", "Cảm biến MAP hỏng"],
           ["Đo nguồn 5 V và tín hiệu MAP", "Kiểm tra giắc và dây"],
           "Nên kiểm tra sớm."),
    _entry("P0108", "Khí nạp", "warning", "Tín hiệu cảm biến MAP quá cao",
           "Điện áp tín hiệu MAP cao bất thường.",
           ["Ống chân không tuột", "Dây tín hiệu chạm nguồn", "Cảm biến MAP hỏng"],
           ["Kiểm tra ống chân không", "Đo tín hiệu MAP"],
           "Nên kiểm tra sớm."),
    _entry("P0110", "Khí nạp", "info", "Lỗi mạch cảm biến nhiệt độ khí nạp (IAT)",
           "ECU nhận tín hiệu nhiệt độ khí nạp bất thường.",
           ["Cảm biến IAT hỏng", "Giắc hoặc dây hỏng"],
           ["Đọc giá trị IAT khi máy nguội", "Kiểm tra giắc và dây"],
           "Không nguy hiểm tức thì; kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0111", "Khí nạp", "info", "Cảm biến nhiệt độ khí nạp đọc sai khoảng",
           "Giá trị IAT không hợp lý so với nhiệt độ ngoài trời và nhiệt độ máy.",
           ["Cảm biến IAT trôi giá trị", "Tiếp xúc giắc kém"],
           ["So IAT với nhiệt độ ngoài trời khi máy nguội"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0112", "Khí nạp", "info", "Tín hiệu cảm biến nhiệt độ khí nạp quá thấp",
           "Điện áp cảm biến IAT thấp bất thường.",
           ["Dây tín hiệu chạm mát", "Cảm biến IAT hỏng"],
           ["Đo điện áp và điện trở cảm biến IAT"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0113", "Khí nạp", "info", "Tín hiệu cảm biến nhiệt độ khí nạp quá cao",
           "Điện áp cảm biến IAT cao bất thường, thường do hở mạch.",
           ["Giắc tuột", "Dây đứt", "Cảm biến IAT hỏng"],
           ["Đo điện áp và điện trở cảm biến IAT", "Kiểm tra giắc"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0120", "Bướm ga", "warning", "Lỗi mạch cảm biến vị trí bướm ga A",
           "ECU nhận tín hiệu vị trí bướm ga bất thường; xe có thể vào chế độ an toàn, hạn chế ga.",
           ["Cảm biến vị trí bướm ga hỏng", "Giắc hoặc dây hỏng", "Cổ hút bướm ga bẩn"],
           ["Đọc tín hiệu TPS khi đạp ga từ từ", "Kiểm tra giắc và dây", "Vệ sinh cổ hút"],
           "Lái cẩn thận vì xe có thể đột ngột yếu ga; nên kiểm tra sớm."),
    _entry("P0121", "Bướm ga", "warning", "Cảm biến vị trí bướm ga A đọc sai khoảng",
           "Tín hiệu bướm ga không khớp với lưu lượng khí nạp hoặc áp suất đường nạp.",
           ["Cảm biến TPS mòn", "Cổ hút bướm ga bẩn"],
           ["Đọc đường cong tín hiệu TPS", "Vệ sinh cổ hút bướm ga"],
           "Nên kiểm tra sớm."),
    _entry("P0122", "Bướm ga", "warning", "Tín hiệu cảm biến vị trí bướm ga A quá thấp",
           "Điện áp tín hiệu TPS thấp bất thường.",
           ["Dây tín hiệu chạm mát", "Mất nguồn 5 V", "Cảm biến TPS hỏng"],
           ["Đo nguồn và tín hiệu TPS"],
           "Nên kiểm tra sớm; xe có thể vào chế độ an toàn."),
    _entry("P0123", "Bướm ga", "warning", "Tín hiệu cảm biến vị trí bướm ga A quá cao",
           "Điện áp tín hiệu TPS cao bất thường.",
           ["Dây tín hiệu chạm nguồn", "Hở mạch mát cảm biến", "Cảm biến TPS hỏng"],
           ["Đo nguồn, mát và tín hiệu TPS"],
           "Nên kiểm tra sớm; xe có thể vào chế độ an toàn."),
    # ---- Hỗn hợp nhiên liệu ---------------------------------------------------
    _entry("P0171", "Nhiên liệu", "warning", "Hỗn hợp quá nghèo (dãy xy-lanh 1)",
           "ECU phải bù thêm nhiều nhiên liệu (fuel trim dương cao) mà vẫn không đạt tỷ lệ chuẩn: có nhiều không khí hoặc thiếu xăng.",
           ["Rò rỉ khí nạp hoặc chân không", "Cảm biến MAF bẩn", "Bơm xăng hoặc lọc xăng yếu", "Kim phun bẩn"],
           ["Kiểm tra rò rỉ chân không", "Kiểm tra áp suất nhiên liệu", "Vệ sinh hoặc thay cảm biến MAF", "Kiểm tra kim phun"],
           "Nên kiểm tra sớm; chạy lâu với hỗn hợp nghèo làm máy nóng và yếu."),
    _entry("P0172", "Nhiên liệu", "warning", "Hỗn hợp quá giàu (dãy xy-lanh 1)",
           "ECU phải cắt bớt nhiều nhiên liệu (fuel trim âm sâu) mà hỗn hợp vẫn thừa xăng.",
           ["Kim phun rò", "Áp suất nhiên liệu quá cao", "Cảm biến MAF hoặc ECT đọc sai", "Lọc gió tắc"],
           ["Kiểm tra áp suất nhiên liệu", "Kiểm tra kim phun", "Kiểm tra cảm biến MAF và ECT"],
           "Nên kiểm tra sớm; xe tốn xăng và có thể hại bộ xúc tác."),
    _entry("P0174", "Nhiên liệu", "warning", "Hỗn hợp quá nghèo (dãy xy-lanh 2)",
           "Giống P0171 nhưng ở dãy xy-lanh 2 (máy chữ V).",
           ["Rò rỉ khí nạp", "Cảm biến MAF bẩn", "Áp suất nhiên liệu thấp"],
           ["Kiểm tra rò rỉ chân không", "Kiểm tra áp suất nhiên liệu", "Kiểm tra cảm biến MAF"],
           "Nên kiểm tra sớm."),
    _entry("P0175", "Nhiên liệu", "warning", "Hỗn hợp quá giàu (dãy xy-lanh 2)",
           "Giống P0172 nhưng ở dãy xy-lanh 2 (máy chữ V).",
           ["Kim phun rò", "Áp suất nhiên liệu cao", "Cảm biến đọc sai"],
           ["Kiểm tra áp suất nhiên liệu", "Kiểm tra kim phun"],
           "Nên kiểm tra sớm."),
    # ---- Đánh lửa và cảm biến vị trí ----------------------------------------
    _entry("P0300", "Đánh lửa", "warning", "Bỏ máy ngẫu nhiên hoặc nhiều xy-lanh",
           "ECU phát hiện đốt cháy không đều ở nhiều xy-lanh; máy rung và yếu.",
           ["Bugi mòn", "Mô-bin đánh lửa yếu", "Rò rỉ khí nạp", "Áp suất nhiên liệu thấp"],
           ["Kiểm tra bugi và mô-bin", "Kiểm tra rò rỉ khí nạp", "Kiểm tra áp suất nhiên liệu", "Đo áp suất nén nếu cần"],
           "Nếu đèn check engine nhấp nháy, giảm tốc và dừng xe sớm vì có thể hỏng bộ xúc tác."),
    _entry("P0325", "Đánh lửa", "warning", "Lỗi mạch cảm biến kích nổ 1 (dãy 1)",
           "ECU không đọc được cảm biến kích nổ nên giảm góc đánh lửa để bảo vệ máy; xe có thể yếu hơn.",
           ["Cảm biến kích nổ hỏng", "Giắc hoặc dây hỏng"],
           ["Đo tín hiệu cảm biến kích nổ", "Kiểm tra giắc và dây"],
           "Tránh tăng tốc gấp và chở nặng; nên kiểm tra sớm."),
    _entry("P0335", "Đánh lửa", "warning", "Lỗi mạch cảm biến vị trí trục khuỷu A",
           "ECU mất hoặc nhận sai tín hiệu trục khuỷu; xe có thể khó nổ hoặc chết máy khi đang chạy.",
           ["Cảm biến trục khuỷu hỏng", "Giắc hoặc dây hỏng", "Vành răng tín hiệu hỏng"],
           ["Đo tín hiệu cảm biến trục khuỷu", "Kiểm tra giắc, dây và khe hở cảm biến"],
           "Nên kiểm tra ngay vì xe có thể chết máy giữa đường."),
    _entry("P0340", "Đánh lửa", "warning", "Lỗi mạch cảm biến vị trí trục cam A",
           "ECU mất hoặc nhận sai tín hiệu trục cam; xe có thể khó nổ hoặc yếu.",
           ["Cảm biến trục cam hỏng", "Giắc hoặc dây hỏng", "Lệch cam"],
           ["Đo tín hiệu cảm biến trục cam", "Kiểm tra giắc và dây", "Kiểm tra cân cam nếu cần"],
           "Nên kiểm tra sớm."),
    # ---- Khí thải -----------------------------------------------------------
    _entry("P0400", "Khí thải", "info", "Lỗi lưu lượng hồi lưu khí xả (EGR)",
           "Hệ thống EGR không đạt lưu lượng như ECU yêu cầu.",
           ["Van EGR kẹt", "Đường EGR đóng muội"],
           ["Kiểm tra hoạt động van EGR", "Vệ sinh đường EGR"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0401", "Khí thải", "info", "Lưu lượng EGR không đủ",
           "Lượng khí xả hồi lưu thấp hơn yêu cầu, thường do muội than.",
           ["Đường EGR tắc", "Van EGR kẹt đóng"],
           ["Vệ sinh van và đường EGR"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0402", "Khí thải", "info", "Lưu lượng EGR quá lớn",
           "Lượng khí xả hồi lưu cao hơn yêu cầu; máy có thể rung khi cầm chừng.",
           ["Van EGR kẹt mở", "Điều khiển van EGR lỗi"],
           ["Kiểm tra van EGR và mạch điều khiển"],
           "Kiểm tra sớm nếu máy rung khi cầm chừng."),
    _entry("P0420", "Khí thải", "info", "Hiệu suất bộ xúc tác thấp (dãy 1)",
           "Cảm biến oxy sau bộ xúc tác cho thấy bộ xúc tác xử lý khí thải kém.",
           ["Bộ xúc tác xuống cấp", "Cảm biến oxy sau xúc tác hỏng", "Rò rỉ ống xả"],
           ["So sánh tín hiệu cảm biến oxy trước và sau xúc tác", "Kiểm tra rò rỉ ống xả"],
           "Không nguy hiểm tức thì; có thể ảnh hưởng kiểm định khí thải."),
    _entry("P0430", "Khí thải", "info", "Hiệu suất bộ xúc tác thấp (dãy 2)",
           "Giống P0420 nhưng ở dãy xy-lanh 2.",
           ["Bộ xúc tác xuống cấp", "Cảm biến oxy sau xúc tác hỏng"],
           ["So sánh tín hiệu cảm biến oxy trước và sau xúc tác"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0440", "Khí thải", "info", "Lỗi hệ thống kiểm soát hơi xăng (EVAP)",
           "ECU phát hiện hệ thống thu hồi hơi xăng hoạt động không đúng.",
           ["Nắp bình xăng không kín", "Van thanh lọc hỏng", "Ống EVAP rò"],
           ["Kiểm tra nắp bình xăng", "Thử khói hệ thống EVAP"],
           "Kiểm tra nắp bình xăng; không nguy hiểm tức thì."),
    _entry("P0441", "Khí thải", "info", "Lưu lượng thanh lọc EVAP không đúng",
           "Van thanh lọc hơi xăng không điều khiển đúng lưu lượng.",
           ["Van thanh lọc kẹt", "Ống EVAP tắc hoặc rò"],
           ["Kiểm tra van thanh lọc", "Kiểm tra đường ống EVAP"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0442", "Khí thải", "info", "Rò rỉ nhỏ hệ thống EVAP",
           "Hệ thống hơi xăng có rò rỉ nhỏ.",
           ["Nắp bình xăng mòn gioăng", "Ống EVAP nứt nhỏ"],
           ["Kiểm tra nắp bình xăng", "Thử khói hệ thống EVAP"],
           "Kiểm tra nắp bình xăng; không nguy hiểm tức thì."),
    _entry("P0446", "Khí thải", "info", "Lỗi mạch điều khiển van thông hơi EVAP",
           "Van thông hơi của hệ thống EVAP không hoạt động đúng.",
           ["Van thông hơi kẹt", "Dây điều khiển hỏng"],
           ["Kiểm tra van thông hơi và mạch điều khiển"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0455", "Khí thải", "info", "Rò rỉ lớn hệ thống EVAP",
           "Hệ thống hơi xăng có rò rỉ lớn, thường do nắp bình xăng.",
           ["Nắp bình xăng mở hoặc hỏng", "Ống EVAP tuột"],
           ["Kiểm tra nắp bình xăng", "Thử khói hệ thống EVAP"],
           "Đóng chặt nắp bình xăng; nếu mùi xăng nặng thì kiểm tra ngay."),
    _entry("P0456", "Khí thải", "info", "Rò rỉ rất nhỏ hệ thống EVAP",
           "Hệ thống hơi xăng có rò rỉ rất nhỏ.",
           ["Gioăng nắp bình xăng mòn", "Ống EVAP nứt chân chim"],
           ["Thử khói hệ thống EVAP"],
           "Không nguy hiểm tức thì."),
    # ---- Tốc độ, cầm chừng, điện ----------------------------------------------
    _entry("P0500", "Cảm biến tốc độ", "warning", "Lỗi cảm biến tốc độ xe A",
           "ECU không nhận được tín hiệu tốc độ xe; đồng hồ tốc độ và việc chuyển số có thể sai.",
           ["Cảm biến tốc độ hỏng", "Giắc hoặc dây hỏng"],
           ["Đọc tín hiệu tốc độ khi chạy thử", "Kiểm tra giắc và dây"],
           "Nên kiểm tra sớm vì các hệ thống hỗ trợ lái có thể bị ảnh hưởng."),
    _entry("P0505", "Cầm chừng", "info", "Lỗi hệ thống điều khiển cầm chừng",
           "ECU không giữ được vòng tua cầm chừng như mong muốn.",
           ["Cổ hút hoặc van cầm chừng bẩn", "Rò rỉ khí nạp"],
           ["Vệ sinh cổ hút bướm ga", "Kiểm tra rò rỉ khí nạp"],
           "Kiểm tra sớm nếu xe dễ chết máy khi dừng đèn đỏ."),
    _entry("P0506", "Cầm chừng", "info", "Vòng tua cầm chừng thấp hơn mong muốn",
           "Vòng tua khi dừng thấp hơn mức ECU đặt ra.",
           ["Cổ hút bướm ga bẩn", "Lọc gió tắc"],
           ["Vệ sinh cổ hút bướm ga", "Kiểm tra lọc gió"],
           "Kiểm tra sớm nếu xe rung hoặc dễ chết máy."),
    _entry("P0507", "Cầm chừng", "info", "Vòng tua cầm chừng cao hơn mong muốn",
           "Vòng tua khi dừng cao hơn mức ECU đặt ra, thường do lọt khí.",
           ["Rò rỉ chân không", "Van cầm chừng kẹt"],
           ["Kiểm tra rò rỉ chân không", "Vệ sinh cổ hút bướm ga"],
           "Kiểm tra trong lần bảo dưỡng tới."),
    _entry("P0560", "Điện", "warning", "Điện áp hệ thống bất thường",
           "ECU ghi nhận điện áp nguồn không ổn định.",
           ["Ắc quy yếu", "Máy phát sạc kém", "Cọc bình lỏng hoặc oxy hóa"],
           ["Đo điện áp ắc quy khi tắt máy và khi nổ máy", "Kiểm tra máy phát và cọc bình"],
           "Nên kiểm tra sớm để tránh xe không nổ được."),
    _entry("P0562", "Điện", "warning", "Điện áp hệ thống thấp",
           "Điện áp nguồn thấp hơn mức ECU cho phép, thường do máy phát sạc kém.",
           ["Máy phát sạc kém", "Dây curoa máy phát trượt", "Ắc quy hỏng"],
           ["Đo điện áp sạc khi nổ máy", "Kiểm tra máy phát và dây curoa", "Kiểm tra ắc quy"],
           "Hạn chế dùng điều hòa và đèn công suất lớn; kiểm tra sớm."),
    _entry("P0563", "Điện", "warning", "Điện áp hệ thống cao",
           "Điện áp nguồn cao hơn mức cho phép, thường do bộ điều áp máy phát hỏng.",
           ["Bộ điều áp máy phát hỏng", "Dây cảm biến điện áp hỏng"],
           ["Đo điện áp sạc khi nổ máy", "Kiểm tra bộ điều áp máy phát"],
           "Nên kiểm tra sớm vì quá áp có thể làm hỏng thiết bị điện."),
    _entry("P0700", "Hộp số", "warning", "Hộp số tự động báo lỗi",
           "Bộ điều khiển hộp số đã ghi một mã lỗi riêng và yêu cầu bật đèn báo.",
           ["Lỗi bên trong hộp số hoặc cảm biến hộp số"],
           ["Đọc mã lỗi của bộ điều khiển hộp số bằng máy chẩn đoán", "Kiểm tra mức và chất lượng dầu hộp số"],
           "Nên kiểm tra sớm; tránh tăng tốc gấp nếu hộp số chuyển số bất thường."),
]


def _misfire(cylinder: int) -> DtcInfo:
    return _entry(
        f"P030{cylinder}", "Đánh lửa", "warning", f"Bỏ máy ở xy-lanh {cylinder}",
        f"ECU phát hiện xy-lanh {cylinder} đốt cháy không đều; máy rung, yếu và có thể tốn xăng.",
        [f"Bugi xy-lanh {cylinder} mòn", f"Mô-bin xy-lanh {cylinder} yếu", f"Kim phun xy-lanh {cylinder} bẩn", "Áp suất nén thấp"],
        ["Đổi chéo mô-bin hoặc bugi sang xy-lanh khác để khoanh vùng", "Kiểm tra kim phun", "Đo áp suất nén"],
        "Nếu đèn check engine nhấp nháy, giảm tốc và dừng xe sớm vì có thể hỏng bộ xúc tác.",
    )


def _oxygen_family(first: int, bank: int, sensor: int) -> list[DtcInfo]:
    where = "trước bộ xúc tác" if sensor == 1 else "sau bộ xúc tác"
    name = f"cảm biến oxy dãy {bank} số {sensor} ({where})"
    faults = [
        ("Lỗi mạch", "ECU nhận tín hiệu bất thường từ", ["Cảm biến oxy hỏng", "Giắc hoặc dây hỏng"]),
        ("Điện áp thấp ở", "Tín hiệu điện áp thấp kéo dài từ", ["Cảm biến oxy hỏng", "Rò rỉ khí xả gần cảm biến", "Dây tín hiệu chạm mát"]),
        ("Điện áp cao ở", "Tín hiệu điện áp cao kéo dài từ", ["Cảm biến oxy hỏng", "Hỗn hợp quá giàu", "Dây tín hiệu chạm nguồn"]),
        ("Phản hồi chậm ở", "Tín hiệu chuyển giàu/nghèo quá chậm từ", ["Cảm biến oxy già", "Cảm biến bị nhiễm bẩn"]),
        ("Không có hoạt động ở", "Tín hiệu không dao động từ", ["Cảm biến oxy hỏng", "Hở mạch tín hiệu"]),
        ("Lỗi mạch sấy của", "Bộ sấy không hoạt động đúng ở", ["Bộ sấy cảm biến đứt", "Cầu chì hoặc rơ-le sấy hỏng"]),
    ]
    entries = []
    for offset, (label, meaning, causes) in enumerate(faults):
        entries.append(_entry(
            f"P0{first + offset:03d}", "Khí thải", "info", f"{label} {name}",
            f"{meaning} {name}; ECU có thể điều khiển nhiên liệu kém chính xác hơn.",
            causes,
            ["Đọc dạng sóng tín hiệu cảm biến oxy", "Kiểm tra giắc, dây và bộ sấy", "Kiểm tra rò rỉ khí xả"],
            "Không nguy hiểm tức thì; xe có thể tốn xăng hơn. Kiểm tra trong lần bảo dưỡng tới.",
        ))
    return entries


_ENTRIES += [_misfire(cylinder) for cylinder in range(1, 9)]
for _first, _bank, _sensor in ((130, 1, 1), (136, 1, 2), (150, 2, 1), (156, 2, 2)):
    _ENTRIES += _oxygen_family(_first, _bank, _sensor)

KB: dict[str, DtcInfo] = {entry.code: entry for entry in _ENTRIES}


def explain(code: str) -> dict:
    """Explanation for the UI and the agent. Unknown codes are never guessed."""
    code = code.strip().upper()
    if code in KB:
        info = asdict(KB[code])
        info["causes"], info["checks"] = list(info["causes"]), list(info["checks"])
        return {**info, "known": True, "urgency_label": URGENCY_LABELS[info["urgency"]]}
    manufacturer = bool(DTC_PATTERN.fullmatch(code)) and code[1] in "13"
    title = "Mã riêng của hãng xe" if manufacturer else "Mã chưa có trong kho tra cứu"
    return {
        "code": code,
        "known": False,
        "system": None,
        "urgency": "warning",
        "urgency_label": URGENCY_LABELS["warning"],
        "title": title,
        "meaning": f"{title}: {UNKNOWN_ADVICE}. Car Neuron không đoán ý nghĩa của mã này.",
        "causes": [],
        "checks": [f"Đọc mã {code} bằng máy chẩn đoán của hãng"],
        "advice": "Đưa xe tới garage có máy chẩn đoán phù hợp để kiểm tra.",
    }
