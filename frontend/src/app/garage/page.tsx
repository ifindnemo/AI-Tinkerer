import type { Metadata } from "next";
import Garage from "@/components/garage";
export const metadata: Metadata = {
  title: "Garage",
  description: "Theo dõi telemetry mô phỏng của xe và nhận định từ Car Neuron Agent.",
};
export default function GaragePage() {
  return <Garage />;
}
