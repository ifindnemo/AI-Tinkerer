"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, MapPin, ShieldCheck, Wrench } from "lucide-react";
import type { ServiceAssessment } from "@/lib/service-booking";
import { appointmentSlots, bookingStorageKey, createBooking, dateBounds, decodeBookings, garages, validateAppointment, type Booking } from "@/lib/service-booking";

export default function ServicePlanner({ analysis, vehicleId, urgent = false }: { analysis: ServiceAssessment | null; vehicleId: string; urgent?: boolean }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    function read() {
      try { setBookings(decodeBookings(localStorage.getItem(bookingStorageKey))); setStorageError(""); }
      catch { setStorageError("Không đọc được lịch đã lưu. Kiểm tra quyền lưu trữ của trình duyệt; chưa thể tạo lịch mới."); }
      setLoaded(true);
    }
    // Hydrate browser persistence after mounting, including changes in another tab.
    const timer = setTimeout(read, 0);
    window.addEventListener("storage", read);
    window.addEventListener("autolink-bookings", read);
    return () => {clearTimeout(timer); window.removeEventListener("storage", read); window.removeEventListener("autolink-bookings", read);};
  }, []);
  function persist(next: Booking[]) {
    localStorage.setItem(bookingStorageKey, JSON.stringify(next));
    setBookings(next);
    window.dispatchEvent(new Event("autolink-bookings"));
  }
  const relevant = bookings.filter(booking => booking.vehicleId === vehicleId);
  return <section className="service-planner" id="service-planner" tabIndex={-1} aria-label="Hỗ trợ garage">
    <div className="service-section-heading"><div><span className="section-kicker">BƯỚC TIẾP THEO</span><h2><Wrench size={20} /> Đặt lịch kiểm tra xe</h2></div><span className="service-badge">Lịch hẹn demo</span></div>
    <p className="service-description">Garage và khung giờ minh họa. Lịch được lưu trên trình duyệt, chưa gửi tới garage hoặc xác nhận chỗ trống thực tế.</p>
    {urgent && <p className="critical-service-note">Ưu tiên xử lý sự cố cùng Safety Agent. Bạn có thể lên lịch kiểm tra sau đó; lịch hẹn không thay thế cứu hộ hoặc xác nhận xe có thể tiếp tục chạy.</p>}
    {storageError && <p className="booking-error" role="alert">{storageError}</p>}
    <BookingFlow key={analysis?.id ?? "no-analysis"} analysis={analysis} enabled={loaded && !storageError}
      save={(assessment, garageId, date, time) => {
        const latest = decodeBookings(localStorage.getItem(bookingStorageKey));
        const booking = createBooking(assessment, garageId, date, time, latest);
        // Keep a bounded local history without dropping an active booking.
        if (latest.length >= 100) throw new Error("Bộ nhớ lịch demo đã đầy.");
        persist([booking, ...latest]);
        return booking;
      }} />
    {relevant.length > 0 && <div className="saved-bookings"><h3><CalendarDays size={16} /> Lịch của xe · {relevant.length}</h3>
      {relevant.map(booking => <article key={booking.id} className={`saved-booking ${booking.status}`}>
        <div><strong>{garages.find(garage => garage.id === booking.garageId)?.name}</strong><p>{booking.date.split("-").reverse().join("/")} · {booking.time} · {booking.vehicleName}</p><small>{booking.issue}</small></div>
        <div className="booking-actions"><span>{booking.status === "saved" ? "Đã lưu trên máy" : "Đã hủy"}</span>{booking.status === "saved" && <button className="outline-button" onClick={() => {
          try { const latest = decodeBookings(localStorage.getItem(bookingStorageKey)); persist(latest.map(item => item.id === booking.id ? {...item, status: "cancelled"} : item)); }
          catch {setStorageError("Không lưu được thay đổi. Lịch chưa được hủy.");}
        }}>Hủy lịch demo</button>}</div>
      </article>)}
    </div>}
  </section>;
}

type BookingReview = {assessment: ServiceAssessment; garageId: string; date: string; time: string};
function BookingFlow({analysis, enabled, save}: {
  analysis: ServiceAssessment | null; enabled: boolean;
  save: (assessment: ServiceAssessment, garage: string, date: string, time: string) => Booking;
}) {
  const [step, setStep] = useState<"idle" | "select" | "schedule" | "review" | "done">("idle");
  const [garageId, setGarageId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [deferred, setDeferred] = useState(false);
  const [review, setReview] = useState<BookingReview | null>(null);
  const [consent, setConsent] = useState(false);
  const [created, setCreated] = useState<Booking | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  useEffect(() => {if(step !== "idle") heading.current?.focus({preventScroll:true});},[step]);
  const garage = garages.find(item => item.id === garageId);
  const bounds = dateBounds();
  if (!analysis) return <div className="service-empty"><ShieldCheck size={22} /><div><strong>Chờ dữ liệu của xe</strong><p>Kết nối blackbox để đánh giá trước khi đặt lịch kiểm tra.</p></div></div>;
  if (analysis.severity === "good") return <div className="service-empty healthy"><ShieldCheck size={22} /><div><strong>Chưa có cảnh báo cần đặt lịch sửa chữa</strong><p>{analysis.title}. Tiếp tục theo dõi dữ liệu.</p></div></div>;
  const sorted = garages.filter(item => analysis.powertrain === "ev" ? item.id !== "cooling-lab" : item.id !== "ev-service").sort((a, b) => Number((b.causes as readonly string[]).includes(analysis.cause)) - Number((a.causes as readonly string[]).includes(analysis.cause)));
  const index = step === "select" ? 0 : step === "schedule" ? 1 : 2;
  const reset = () => {setStep("idle");setReview(null);setConsent(false);setError("");};
  return <div className="booking-flow">
    {step === "idle" && <div className="service-consent"><div><h3>Sắp xếp một buổi kiểm tra cho xe</h3><p>{analysis.title} · {analysis.vehicleName}</p><small>Bạn chọn thời gian. Chỉ lưu lịch sau khi bạn xác nhận.</small>{deferred && <p role="status">Đã để sau trong phiên này. Bạn có thể quay lại bất cứ lúc nào.</p>}</div><div className="consent-actions"><button className="primary-button" disabled={!enabled} onClick={() => {setStep("select"); setDeferred(false);}}>Xem garage đề xuất <ArrowRight size={16} /></button><button className="outline-button" onClick={() => setDeferred(true)}>Để sau</button></div></div>}
    {step !== "idle" && step !== "done" && <>
      <ol className="booking-steps" aria-label="Các bước đặt lịch">{["Chọn garage","Chọn thời gian","Xác nhận"].map((label,i)=><li key={label} className={i <= index ? "active" : ""} aria-current={i === index ? "step" : undefined}><span>{i < index ? <Check size={13} /> : i+1}</span>{label}</li>)}</ol>
      <div className="booking-step-heading"><h3 ref={heading} tabIndex={-1}>{step === "select" ? "Chọn nơi kiểm tra phù hợp" : step === "schedule" ? "Chọn ngày và giờ thuận tiện" : "Kiểm tra trước khi xác nhận"}</h3><button className="booking-dismiss" onClick={reset}>Hủy thao tác</button></div>
    </>}
    {step === "select" && <form onSubmit={event => {event.preventDefault();if(garage){setError("");setStep("schedule");}}}>
      <div className="garage-options" role="radiogroup" aria-label="Chọn garage">
        {sorted.map((item, i) => <label key={item.id} className={`garage-option ${garageId === item.id ? "selected" : ""}`}>
          <input type="radio" name="garage" value={item.id} checked={garageId === item.id} onChange={() => setGarageId(item.id)} required />
          <span className="garage-option-content"><span className="garage-option-name">{item.name}{i === 0 && <small>Gợi ý theo chuyên môn</small>}</span><span><MapPin size={13} /> {item.area} · địa điểm demo</span><b>{item.specialty}</b><span>{item.description}</span></span>
        </label>)}
      </div>
      <div className="booking-footer"><button type="button" className="outline-button" onClick={reset}><ArrowLeft size={15} /> Quay lại</button><button type="submit" className="primary-button" disabled={!garage}>Chọn thời gian <ArrowRight size={15} /></button></div>
    </form>}
    {step === "schedule" && <form onSubmit={event => {event.preventDefault();try {
      validateAppointment(garageId,date,time);
      setReview({assessment:structuredClone(analysis),garageId,date,time});setConsent(false);setError("");setStep("review");
    } catch(e){setError(e instanceof Error ? e.message : "Kiểm tra thông tin lịch.");}}}>
      <div className="booking-selected-garage"><MapPin size={18} /><div><strong>{garage?.name}</strong><span>{garage?.specialty}</span></div></div>
      <div className="appointment-fields"><label>Ngày kiểm tra<input type="date" aria-label="Ngày kiểm tra" min={bounds.min} max={bounds.max} value={date} required onChange={event => setDate(event.target.value)} /></label><label>Giờ hẹn<select aria-label="Giờ hẹn" value={time} required onChange={event => setTime(event.target.value)}><option value="">Chọn giờ</option>{appointmentSlots.map(slot => <option key={slot}>{slot}</option>)}</select></label></div>
      <p className="appointment-note">Giờ địa phương trên thiết bị · từ ngày mai đến 14 ngày tới. Khung giờ minh họa, chưa xác nhận chỗ trống với garage.</p>
      <div className="booking-footer"><button type="button" className="outline-button" onClick={() => {setStep("select");setError("");}}><ArrowLeft size={15} /> Đổi garage</button><button type="submit" className="primary-button">Kiểm tra lịch hẹn <ArrowRight size={15} /></button></div>
    </form>}
    {step === "review" && review && <div className="booking-review">
      <dl><div><dt>Xe</dt><dd>{review.assessment.vehicleName}</dd></div><div><dt>Lý do</dt><dd>{review.assessment.title}</dd></div><div><dt>Garage demo</dt><dd>{garages.find(item=>item.id===review.garageId)?.name}</dd></div><div><dt>Thời gian dự kiến</dt><dd>{review.date.split("-").reverse().join("/")} · {review.time}</dd></div></dl>
      <p>Thông tin trên được giữ nguyên để bạn xem lại. Xác nhận chỉ lưu lịch trên trình duyệt này; chưa gửi yêu cầu tới garage.</p>
      <label className="booking-explicit-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} /><span>Tôi đồng ý lưu lịch demo cho xe, garage và thời gian ở trên.</span></label>
      <div className="booking-footer"><button className="outline-button" onClick={() => {setStep("schedule");setConsent(false);setReview(null);setError("");}}>Sửa thông tin</button><button className="primary-button" disabled={!enabled || !consent} onClick={() => {
        if(!consent || !enabled || submitting.current)return;
        submitting.current=true;
        try {const booking=save(review.assessment,review.garageId,review.date,review.time);setCreated(booking);setError("");setStep("done");}
        catch(e){setError(e instanceof Error ? e.message : "Không lưu được lịch. Hãy thử lại.");}
        finally{submitting.current=false;}
      }}>Xác nhận lưu lịch demo <Check size={16} /></button></div>
    </div>}
    {step === "done" && created && <div className="booking-success" role="status"><Check size={24} /><div><h3 ref={heading} tabIndex={-1}>Đã lưu lịch hẹn demo</h3><p>{garages.find(item=>item.id===created.garageId)?.name} · {created.date.split("-").reverse().join("/")} · {created.time}</p><p>Bạn có thể xem hoặc hủy lịch bên dưới. Garage chưa nhận được yêu cầu này.</p></div></div>}
    {error && <p className="booking-error" role="alert">{error}</p>}
  </div>;
}
