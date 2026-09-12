import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Car Neuron — Hiểu chiếc xe của bạn",
  description:
    "Garage 3D và phân tích dữ liệu blackbox. Frontend demo với model xe 3D local.",
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
