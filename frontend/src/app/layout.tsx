import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Car Neuron — Hiểu chiếc xe của bạn",
    template: "%s · Car Neuron",
  },
  description:
    "Agent sức khỏe xe đọc dữ liệu blackbox mỗi giây, suy luận đa tín hiệu và cảnh báo quá nhiệt kèm bằng chứng.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
