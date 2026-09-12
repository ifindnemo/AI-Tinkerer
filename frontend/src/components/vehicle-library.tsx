"use client";
import Image from "next/image";
import { useState } from "react";
import { CarFront, Check, Search, HardDrive } from "lucide-react";
import { vehicles, powertrainLabels, type Vehicle } from "@/lib/vehicles";

export default function VehicleLibrary({
  selected,
  onSelect,
}: {
  selected: Vehicle;
  onSelect: (vehicle: Vehicle) => void;
}) {
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
    <section className="vehicle-library compact-library" aria-label="Thư viện xe">
      <div className="library-heading">
        <div>
          <span className="section-kicker">CHỌN XE ĐỂ KHÁM PHÁ</span>
          <h2>
            Garage của bạn <span>{vehicles.length} model</span>
          </h2>
        </div>
        <div className="library-filters">
          <label className="vehicle-search">
            <Search size={16} />
            <input
              aria-label="Tìm xe"
              placeholder="Tìm tên xe, đời xe…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Lọc hãng xe"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          >
            <option value="all">Tất cả hãng</option>
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
            aria-label={`Chọn ${v.brand} ${v.name}${v.year ? ` ${v.year}` : ""}`}
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
              <span className="choice-year">{v.year ?? "Chưa rõ đời"}</span>
              {selected.id === v.id && (
                <span className="choice-check">
                  <Check size={13} />
                </span>
              )}
            </span>
            <span className="choice-copy"><span className="choice-brand">{v.brand}</span>
            <strong>{v.name}</strong>
            <span className="choice-detail">
              {powertrainLabels[v.powertrain]} · {v.body}
            </span>
            <span className="choice-source">
              <HardDrive size={11} /> 3D local
            </span></span>
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="library-empty">
          Không tìm thấy xe phù hợp.{" "}
          <button
            onClick={() => {
              setQuery("");
              setBrand("all");
            }}
          >
            Xóa bộ lọc
          </button>
        </div>
      )}
      <p className="library-footnote">
        Model 3D được lưu trực tiếp trong ứng dụng. Garage chỉ hiển thị xe có file local.
      </p>
    </section>
  );
}
