import type { Metadata } from "next";
import WorkflowPage from "@/components/workflow/workflow-page";

export const metadata: Metadata = {
  title: "Workflow · Kiến trúc & Luồng hoạt động Car Neuron",
  description:
    "Motion graphic trực quan hóa luồng dữ liệu kép (Blackbox ECU 1 Hz + Camera tài xế 12 fps), Luật an toàn cứng, Agent AI điều phối công cụ và Phương án hành động thông minh của Car Neuron.",
};

export default function WorkflowRoute() {
  return <WorkflowPage />;
}
