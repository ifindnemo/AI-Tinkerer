"use client";
import {Download, Radio} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import type {BlackboxTransfer} from "@/lib/blackbox/types";
export default function BlackboxTransferStatus({transfer:t,backend}:{transfer:BlackboxTransfer;backend?:import("@/lib/backend/contract").BackendState}){
  const {t:tx}=useLang();
  const download=()=>{
    if(!t.lastBatch)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(t.lastBatch,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`blackbox-${t.lastBatch.vehicleId}-${t.lastBatch.batchId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="blackbox-transfer" aria-label={tx("Gói dữ liệu blackbox","Blackbox data batch")}>
    <div><Radio size={15}/><span>{tx(`1 giây / mẫu · ${t.target} mẫu / gói`,`1 sample / s · ${t.target} samples / batch`)}</span><span data-testid="batch-buffer">{tx(`Đang gom ${t.buffered}/${t.target}`,`Collecting ${t.buffered}/${t.target}`)}</span></div>
    <div><span>{backend ? backend.phase === "sending" ? tx("Đang gửi backend…","Sending to backend…") : backend.phase === "error" ? tx("Gửi chưa hoàn tất","Send not completed") : backend.reply ? tx("Backend đã nhận gói gần nhất","Backend received the latest batch") : tx("Chờ đủ gói để gửi backend","Waiting for a full batch") : tx("Gói dữ liệu cục bộ · Chưa gửi backend","Local batch · Not sent to a backend")}</span><button className="outline-button" disabled={!t.lastBatch} onClick={download}><Download size={14}/>{tx(`JSON ${t.lastBatch?.recordCount ?? t.target} mẫu`,`JSON ${t.lastBatch?.recordCount ?? t.target} samples`)}</button></div>
  </div>;
}
