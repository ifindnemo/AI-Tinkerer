"use client";
import {Download, Radio} from "lucide-react";
import type {BlackboxTransfer} from "@/lib/blackbox/types";
export default function BlackboxTransferStatus({transfer:t}:{transfer:BlackboxTransfer}){
  const download=()=>{
    if(!t.lastBatch)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(t.lastBatch,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`blackbox-${t.lastBatch.vehicleId}-${t.lastBatch.batchId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="blackbox-transfer" aria-label="Gói dữ liệu blackbox">
    <div><Radio size={15}/><span>1 giây / mẫu · 15 mẫu / gói</span><span data-testid="batch-buffer">Đang gom {t.buffered}/15</span></div>
    <div><span>Gói dữ liệu cục bộ · Chưa gửi backend</span><button className="outline-button" disabled={!t.lastBatch} onClick={download}><Download size={14}/>JSON 15 mẫu</button></div>
  </div>;
}
