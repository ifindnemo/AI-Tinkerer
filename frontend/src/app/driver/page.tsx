import type {Metadata} from "next";
import DriverPage from "@/components/driver/driver-page";

export const metadata: Metadata = {
  title: "Tài xế",
  description: "Giám sát chú ý của tài xế bằng camera: xử lý ngay trên trình duyệt, chỉ gửi chỉ số có cấu trúc.",
};

export default function Page() {
  return <DriverPage />;
}
