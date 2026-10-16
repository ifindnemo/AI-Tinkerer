"use client";
import {useState, useSyncExternalStore} from "react";
import {CalendarCheck, CalendarPlus, Check, Download, LoaderCircle} from "lucide-react";
import type {Appointment, PendingBooking} from "@/lib/backend/contract";
import {bookingStore} from "@/lib/agent/booking-store";
import {slotText, type T} from "./tool-step-view";

// The agent only proposes; nothing is saved until the driver confirms here.
export default function BookingCard({pending,appointment,t,lang}:{pending:PendingBooking|null;appointment:Appointment|null;t:T;lang:string}){
 const locale=lang==='en'?'en-GB':'vi-VN';
 const store=useSyncExternalStore(bookingStore.subscribe,bookingStore.get,bookingStore.get);
 const saved=pending?store.saved[pending.id]??null:null;
 const skipped=!!pending&&store.skipped.includes(pending.id);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const booked=saved??appointment;
 async function confirm(){
  if(!pending||saving)return;
  setSaving(true);setError('');
  try{
   const response=await fetch(`/api/vehicle/incidents/${pending.incident_id}/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pending_action_id:pending.id})});
   const data=await response.json().catch(()=>null) as {result?:Appointment}|null;
   if(!response.ok||!data?.result?.id)throw new Error(response.status===409?t('Lịch này đã được xử lý hoặc không còn hiệu lực.','This appointment was already handled or is no longer valid.'):t('Chưa lưu được lịch. Thử lại sau.','Could not save the appointment. Try again.'));
   bookingStore.save(pending.id,data.result);
  }catch(e){setError(e instanceof Error?e.message:t('Chưa lưu được lịch. Thử lại sau.','Could not save the appointment. Try again.'));}
  finally{setSaving(false);}
 }
 if(booked)return <section className="agent-booking-card booked" data-testid="backend-booking" data-state="booked" aria-label={t('Lịch hẹn garage','Garage appointment')}>
  <h4><CalendarCheck size={14}/>{t('Đã lưu lịch hẹn','Appointment saved')}</h4>
  <p><b>{booked.garage_id}</b> · {slotText(booked.slot,locale)}</p>
  <a className="text-button" href={`/api/vehicle/appointments/${booked.id}`} download data-testid="backend-booking-ics"><Download size={13}/>{t('Tải file .ics','Download .ics')}</a>
  <small>{t('Lịch được lưu trong hệ thống Car Neuron; garage chưa được liên hệ (bản thử nghiệm).','Saved in Car Neuron; the garage has not been contacted (prototype).')}</small>
 </section>;
 if(!pending||skipped)return null;
 return <section className="agent-booking-card" data-testid="backend-booking" data-state="proposed" aria-label={t('Đề xuất đặt lịch','Appointment proposal')}>
  <h4><CalendarPlus size={14}/>{t('Agent đề xuất đặt lịch','The agent proposes an appointment')}</h4>
  <p><b>{pending.payload.garage_id}</b> · {slotText(pending.payload.slot,locale)}</p>
  {pending.payload.address&&<small>{pending.payload.address.startsWith(pending.payload.garage_id)?pending.payload.address.slice(pending.payload.garage_id.length).replace(/^[\s,]+/,''):pending.payload.address}{typeof pending.payload.distance_km==='number'?` · ${pending.payload.distance_km.toLocaleString(locale)} km`:''}</small>}
  <div className="agent-booking-actions">
   <button type="button" className="primary-button" onClick={()=>void confirm()} disabled={saving} data-testid="backend-booking-confirm">{saving?<LoaderCircle className="spin" size={13}/>:<Check size={13}/>}{t('Xác nhận đặt lịch','Confirm appointment')}</button>
   <button type="button" className="text-button" onClick={()=>pending&&bookingStore.skip(pending.id)} disabled={saving} data-testid="backend-booking-skip">{t('Để sau','Not now')}</button>
  </div>
  {error&&<p className="agent-booking-error" role="alert">{error}</p>}
  <small>{t('Chưa đặt gì cho đến khi bạn xác nhận. Lịch lưu trong Car Neuron; garage chưa được liên hệ.','Nothing is booked until you confirm. Saved in Car Neuron; the garage is not contacted.')}</small>
 </section>;
}

