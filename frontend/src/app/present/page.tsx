import type { Metadata } from "next";
import Present from "@/components/present/present";

export const metadata: Metadata = {
  title: "Trình chiếu",
  description: "Bài thuyết trình 7 phút bằng 5 slide: Car Neuron là gì, demo trực tiếp, bên trong hoạt động ra sao, thử thách và bài học.",
};

export default function PresentPage() {
  return <Present />;
}
