"use client";
import {useState} from "react";
import {Check, Cpu, Pencil, X} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {apiFailureMessage, vehicleApi} from "@/lib/backend/client";
import {SIGNALS} from "@/lib/device/signals";
import type {DeviceProfile} from "@/lib/device/types";

export function profileName(profile: DeviceProfile | null, fallback: string) {
  if (profile?.display_name) return profile.display_name;
  if (profile?.make) return profile.model_year_guess ? `${profile.make} · ${profile.model_year_guess}` : profile.make;
  return fallback;
}

export default function VehicleProfileCard({profile, vehicleId}: {profile: DeviceProfile | null; vehicleId: string}) {
  const {t, time} = useLang();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const value = name.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await vehicleApi(`vehicles/${vehicleId}/profile`, {body: {display_name: value.slice(0, 60)}});
      setEditing(false);
    } catch (failure) {
      setError(apiFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  if (!profile?.known) {
    return (
      <section className="vehicle-profile-card waiting" aria-label={t("Hồ sơ xe", "Vehicle profile")} data-testid="vehicle-profile">
        <span className="section-kicker">{t("CHỜ THIẾT BỊ", "WAITING FOR THE DEVICE")}</span>
        <h3><Cpu size={16} />{t("Chưa nhận xe", "No car detected yet")}</h3>
        <p>{t("Cắm thiết bị vào cổng OBD và chạy gateway. Car Neuron sẽ đọc VIN và danh sách cảm biến của xe.", "Plug the device into the OBD port and run the gateway. Car Neuron will read the VIN and the car's sensor list.")}</p>
      </section>
    );
  }
  const device = profile.devices[0];
  return (
    <section className="vehicle-profile-card" aria-label={t("Hồ sơ xe", "Vehicle profile")} data-testid="vehicle-profile">
      <span className="section-kicker">{t("ĐÃ NHẬN XE", "CAR DETECTED")}</span>
      {editing ? (
        <form className="profile-rename" onSubmit={event => {event.preventDefault(); void save();}}>
          <input aria-label={t("Tên xe", "Car name")} value={name} maxLength={60} autoFocus onChange={event => setName(event.target.value)} disabled={busy} />
          <button type="submit" className="icon-button" aria-label={t("Lưu tên xe", "Save car name")} disabled={busy || !name.trim()}><Check size={15} /></button>
          <button type="button" className="icon-button" aria-label={t("Hủy", "Cancel")} onClick={() => setEditing(false)} disabled={busy}><X size={15} /></button>
        </form>
      ) : (
        <h3>
          {profileName(profile, t("Xe của bạn", "Your car"))}
          <button className="icon-button" aria-label={t("Đặt tên xe", "Rename the car")} title={t("Đặt tên xe", "Rename the car")} onClick={() => {setName(profile.display_name ?? ""); setEditing(true);}}><Pencil size={13} /></button>
        </h3>
      )}
      {error && <p className="backend-error" role="alert">{error}</p>}
      <dl>
        <div><dt>VIN</dt><dd data-testid="profile-vin">{profile.vin ?? t("Xe không trả VIN", "Not reported by the car")}</dd></div>
        <div><dt>{t("Hãng", "Make")}</dt><dd>{profile.make ?? t("Chưa xác định", "Unknown")}</dd></div>
        <div><dt>{t("Năm sản xuất", "Model year")}</dt><dd>{profile.model_year_guess ? `${profile.model_year_guess} · ${t("ước lượng từ VIN", "estimated from the VIN")}` : "—"}</dd></div>
        <div><dt>{t("Giao thức", "Protocol")}</dt><dd>{profile.protocol ?? "—"}</dd></div>
        <div><dt>{t("Cảm biến", "Sensors")}</dt><dd data-testid="profile-sensors">{profile.supported_signals.length}/{SIGNALS.length} {t("tín hiệu xe cung cấp", "signals reported by the car")}</dd></div>
        {device && <div><dt>{t("Thiết bị", "Device")}</dt><dd>{device.label || device.id}{device.last_seen_at ? ` · ${time(device.last_seen_at)}` : ""}</dd></div>}
      </dl>
    </section>
  );
}
