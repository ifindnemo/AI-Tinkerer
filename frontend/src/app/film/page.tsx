import type { Metadata } from "next";
import Film from "@/components/film/film";
export const metadata: Metadata = {
  title: "Phim giới thiệu",
  description: "Phim giới thiệu 90 giây: dữ liệu xe, cảnh báo quá nhiệt, camera tài xế và quyền riêng tư với Car Neuron.",
};
export default function FilmPage() {
  return <Film />;
}
