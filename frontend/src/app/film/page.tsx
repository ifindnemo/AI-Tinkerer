import type { Metadata } from "next";
import Film from "@/components/film/film";
export const metadata: Metadata = {
  title: "Phim giới thiệu",
  description: "Motion graphic ~80 giây về cách Car Neuron đọc dữ liệu xe và cảnh báo quá nhiệt.",
};
export default function FilmPage() {
  return <Film />;
}
