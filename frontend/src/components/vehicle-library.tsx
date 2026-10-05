"use client";
import Image from "next/image";
import { useState } from "react";
import { CarFront, Check, Search, HardDrive } from "lucide-react";
import { vehicles, powertrainLabels, type Vehicle } from "@/lib/vehicles";
import { useLang } from "@/hooks/use-preferences";
import { pick } from "@/lib/preferences";

export default function VehicleLibrary({
  selected,
  onSelect,
}: {
  selected: Vehicle;
  onSelect: (vehicle: Vehicle) => void;
}) {
  const {t, lang} = useLang();
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("all");
  const filtered = vehicles.filter(
    (v) =>
      (brand === "all" || v.brand === brand) &&
      `${v.brand} ${v.name} ${v.year ?? ""}`
        .toLocaleLowerCase()
        .replace(/[\s-]/g, "")
        .includes(query.trim().toLocaleLowerCase().replace(/[\s-]/g, "")),
  );
  return (
    <section className="vehicle-library compact-library" aria-label={t("Thư viện xe", "Car library")}>
      <div className="library-heading">
        <div>
          <span className="section-kicker">{t("CHỌN XE ĐỂ KHÁM PHÁ", "PICK A CAR TO EXPLORE")}</span>
          <h2>
            {t("Garage của bạn", "Your garage")} <span>{vehicles.length} model</span>
          </h2>
        </div>
        <div className="library-filters">
          <label className="vehicle-search">
            <Search size={16} />
            <input
              aria-label={t("Tìm xe", "Search cars")}
              placeholder={t("Tìm tên xe, đời xe…", "Search name, year…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label={t("Lọc hãng xe", "Filter by brand")}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          >
            <option value="all">{t("Tất cả hãng", "All brands")}</option>
            {Array.from(new Set(vehicles.map((v) => v.brand))).map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="vehicle-choices">
        {filtered.map((v) => (
          <button
            key={v.id}
            className={`vehicle-choice ${v.id === selected.id ? "selected" : ""}`}
            aria-pressed={v.id === selected.id}
            aria-label={`${t("Chọn", "Select")} ${v.brand} ${v.name}${v.year ? ` ${v.year}` : ""}`}
            onClick={() => onSelect(v)}
          >
            <span className="vehicle-choice-visual">
              {v.thumbnail ? (
                <Image
                  src={v.thumbnail}
                  alt={`${v.brand} ${v.name}`}
                  fill
                  sizes="200px"
                  unoptimized
                />
              ) : (
                <span className="local-car-emblem">
                  <CarFront size={42} strokeWidth={1.2} />
                  <b>{v.name}</b>
                </span>
              )}
              <span className="choice-year">{v.year ?? t("Chưa rõ đời", "Year unknown")}</span>
              {selected.id === v.id && (
                <span className="choice-check">
                  <Check size={13} />
                </span>
              )}
            </span>
            <span className="choice-copy"><span className="choice-brand">{v.brand}</span>
            <strong>{v.name}</strong>
            <span className="choice-detail">
              {pick(powertrainLabels[v.powertrain], lang)} · {v.body}
            </span>
            <span className="choice-source">
              <HardDrive size={11} /> 3D local
            </span></span>
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="library-empty">
          {t("Không tìm thấy xe phù hợp.", "No matching car.")}{" "}
          <button
            onClick={() => {
              setQuery("");
              setBrand("all");
            }}
          >
            {t("Xóa bộ lọc", "Clear filters")}
          </button>
        </div>
      )}
      <p className="library-footnote">
        {t("Model 3D được lưu trực tiếp trong ứng dụng. Garage chỉ hiển thị xe có file local.", "3D models ship with the app. The garage only lists cars with a local file.")}
      </p>
    </section>
  );
}
