import type { ServiceAssessment } from "./service-booking";

// User supplied mapping: 0 = no fault; 1/2/3 = fault present.
// This reads ground-truth labels, not a classifier prediction from the sensors.
export function assessDatasetLabel(code: string, row: number): ServiceAssessment {
  if (!["0", "1", "2", "3"].includes(code)) throw new Error("Chưa có chú giải cho mã Fault này.");
  const faulty = code !== "0";
  return {
    id: `enginefaultdb-row-${row}`, vehicleId: "enginefaultdb-sample", vehicleName: "Xe mẫu EngineFaultDB (chưa định danh)",
    powertrain: "ice", createdAt: new Date().toISOString(),
    // 'watch' controls the inspection workflow; it does not establish fault severity.
    severity: faulty ? "watch" : "good",
    cause: faulty ? "unclassified" : "normal",
    title: faulty ? `Có lỗi theo nhãn dữ liệu · Fault ${code}` : "Không lỗi theo nhãn dữ liệu · Fault 0",
    summary: faulty ? "Đã xác định có lỗi theo quy ước người dùng cung cấp. Chưa biết bộ phận, mức độ nghiêm trọng hoặc nguyên nhân từ các tín hiệu thô." : "Nhãn Fault 0 được định nghĩa là không lỗi. Đây là nhãn của dòng dữ liệu, không phải đánh giá trực tiếp tình trạng xe hiện tại.",
    evidence: [`EngineFaultDB_Final.xlsx · dòng ${row}`, `Giá trị Fault = ${code}`, "Chú giải 0/1/2/3 do người dùng cung cấp; đơn vị và thang đo cảm biến chưa xác minh."],
    recommendations: faulty ? ["Đề xuất kiểm tra chẩn đoán tổng quát để xác định nguyên nhân trước khi quyết định sửa chữa."] : ["Không đề xuất sửa chữa chỉ dựa trên dòng có nhãn không lỗi."],
  };
}
