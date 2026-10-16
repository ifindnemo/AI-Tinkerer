import type { Metadata } from "next";
import Film from "@/components/film/film";
export const metadata: Metadata = {
  title: "Phim giới thiệu",
  description: "Phim giới thiệu 3 phút 30: Car Neuron là gì, hoạt động ra sao bên trong và những thử thách đã gặp, thuyết minh tiếng Anh.",
};
export default function FilmPage() {
  return <Film />;
}
