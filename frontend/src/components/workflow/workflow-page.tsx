"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Pause, Play } from "lucide-react";
import { useLang } from "@/hooks/use-preferences";
import SiteHeader from "../site/site-header";
import Brand from "../site/brand";
import styles from "./workflow.module.css";

type ScenarioKey = "normal" | "weather" | "overheat" | "drowsy_warm";

type ScenarioConfig = {
  id: ScenarioKey;
  index: string;
  tone: "ok" | "watch" | "critical";
  label: { vi: string; en: string };
  kicker: { vi: string; en: string };
  coolant: number;
  rpm: number;
  load: number;
  speed: number;
  fan: number;
  ambient: number;
  trend: { vi: string; en: string };
  batchSize: number;
  driverState: { vi: string; en: string };
  earClosureSec: number;
  hornActive: boolean;
  guardrailTriggered: boolean;
  guardrailNote: { vi: string; en: string };
  activeTools: ("weather" | "history" | "garages" | "booking")[];
  planCode: string;
  planTitle: { vi: string; en: string };
  planSummary: { vi: string; en: string };
  voiceLine: { vi: string; en: string };
  bookingAllowed: boolean;
};

const SCENARIOS: Record<ScenarioKey, ScenarioConfig> = {
  normal: {
    id: "normal",
    index: "01",
    tone: "ok",
    label: { vi: "Vận hành ổn định", en: "Nominal Cruise" },
    kicker: { vi: "TRẠNG THÁI CHUẨN · 92.4°C", en: "NOMINAL STATE · 92.4°C" },
    coolant: 92.4,
    rpm: 2150,
    load: 32,
    speed: 58,
    fan: 35,
    ambient: 30,
    trend: { vi: "+0.2°C/phút", en: "+0.2°C/min" },
    batchSize: 15,
    driverState: { vi: "Tỉnh táo · Mắt mở", en: "Attentive · Eyes open" },
    earClosureSec: 0.18,
    hornActive: false,
    guardrailTriggered: false,
    guardrailNote: {
      vi: "Nhiệt độ và điện áp nằm trong dải vận hành chuẩn",
      en: "Thermal and electrical channels within nominal range",
    },
    activeTools: ["weather"],
    planCode: "continue_monitoring",
    planTitle: {
      vi: "Tiếp tục hành trình · Giữ yên lặng khoang lái",
      en: "Continue journey · Keep cabin quiet",
    },
    planSummary: {
      vi: "Nhiệt độ nước làm mát và tốc độ quạt đồng bộ với tải động cơ. Hệ thống không phát âm thanh để giữ sự tập trung cho người lái.",
      en: "Coolant temperature and fan speed match engine load. Voice stays silent to preserve driver concentration.",
    },
    voiceLine: {
      vi: "Chế độ yên lặng khi bình thường — chỉ lên tiếng khi phát hiện rủi ro hoặc khi người lái gọi “Hey Neuron”.",
      en: "Silent when nominal — speaks only on warnings or when woken with “Hey Neuron”.",
    },
    bookingAllowed: false,
  },
  weather: {
    id: "weather",
    index: "02",
    tone: "watch",
    label: { vi: "Trời nắng gắt 38°C", en: "38°C Hot Afternoon" },
    kicker: { vi: "ĐỐI CHIẾU MÔI TRƯỜNG · 101.8°C", en: "AMBIENT CORRELATION · 101.8°C" },
    coolant: 101.8,
    rpm: 2480,
    load: 48,
    speed: 64,
    fan: 85,
    ambient: 38,
    trend: { vi: "+1.1°C/phút", en: "+1.1°C/min" },
    batchSize: 15,
    driverState: { vi: "Tỉnh táo · Mắt mở", en: "Attentive · Eyes open" },
    earClosureSec: 0.21,
    hornActive: false,
    guardrailTriggered: false,
    guardrailNote: {
      vi: "Quạt 85% đáp ứng đúng với nhiệt độ môi trường 38°C",
      en: "Fan at 85% responds properly to 38°C ambient heat",
    },
    activeTools: ["weather", "history"],
    planCode: "continue_monitoring",
    planTitle: {
      vi: "Nhiệt tăng do thời tiết · Loại trừ báo động giả",
      en: "Weather-driven warmth · False alarm eliminated",
    },
    planSummary: {
      vi: "Agent tra cứu Open-Meteo tại tọa độ GPS của xe (38°C) và ghi nhận quạt làm mát đang chạy 85%, nhiệt tăng ổn định theo tải nên không báo lỗi ảo.",
      en: "Agent queries Open-Meteo at vehicle GPS (38°C) and confirms the fan is running at 85% with load-proportional heat, preventing a false alarm.",
    },
    voiceLine: {
      vi: "“Nhiệt độ nước làm mát 102 độ tương ứng với nền nhiệt 38 độ ngoài trời, hệ thống quạt đang giải nhiệt tốt.”",
      en: "“Coolant at 102°C matches the 38°C afternoon outside; the cooling fan is dissipating heat normally.”",
    },
    bookingAllowed: false,
  },
  overheat: {
    id: "overheat",
    index: "03",
    tone: "critical",
    label: { vi: "Quá nhiệt · Quạt 0%", en: "Overheating · Fan 0%" },
    kicker: { vi: "LỖI HỆ THỐNG LÀM MÁT · 115.6°C", en: "COOLING FAULT · 115.6°C" },
    coolant: 115.6,
    rpm: 2620,
    load: 36,
    speed: 60,
    fan: 0,
    ambient: 31,
    trend: { vi: "+40°C/phút", en: "+40°C/min" },
    batchSize: 5,
    driverState: { vi: "Tỉnh táo · Đang chạy 60 km/h", en: "Attentive · Driving 60 km/h" },
    earClosureSec: 0.22,
    hornActive: false,
    guardrailTriggered: true,
    guardrailNote: {
      vi: "Chốt chặn vật lý kích hoạt: Nhiệt tăng vọt + Quạt 0% khi xe đang chạy",
      en: "Hard guardrail triggered: Rapid heating + Fan 0% while moving",
    },
    activeTools: ["weather", "history", "garages", "booking"],
    planCode: "garage_when_convenient",
    planTitle: {
      vi: "Giảm tải động cơ · Đề xuất đặt lịch garage gần xe",
      en: "Reduce engine load · Propose nearby garage booking",
    },
    planSummary: {
      vi: "Phát hiện bất thường đa kênh (115.6°C nhưng quạt 0% ở tải phẳng 36%), khớp tiền sử lỗi quạt làm mát. Tìm 5 garage trong bán kính 5 km và tạo lịch hẹn chờ xác nhận.",
      en: "Detects multi-signal anomaly (115.6°C with 0% fan at flat 36% load), matches prior fan fault, locates 5 garages within 5 km and prepares a consent-gated booking.",
    },
    voiceLine: {
      vi: "“Cảnh báo: Nước làm mát tăng nhanh lên 116 độ nhưng quạt không quay. Hãy giảm tải và xác nhận lịch kiểm tra tại garage gần nhất.”",
      en: "“Warning: Coolant climbed to 116°C while the fan stays off. Reduce engine load and confirm an inspection at the nearest garage.”",
    },
    bookingAllowed: true,
  },
  drowsy_warm: {
    id: "drowsy_warm",
    index: "04",
    tone: "critical",
    label: { vi: "Máy nóng + Tài xế buồn ngủ", en: "Warm Engine + Drowsy Driver" },
    kicker: { vi: "HỢP NHẤT AN TOÀN KÉP · ƯU TIÊN SINH MẠNG", en: "DUAL-STREAM OVERRIDE · LIFE SAFETY FIRST" },
    coolant: 107.2,
    rpm: 2380,
    load: 41,
    speed: 65,
    fan: 20,
    ambient: 33,
    trend: { vi: "+18°C/phút", en: "+18°C/min" },
    batchSize: 5,
    driverState: { vi: "Nhắm mắt 1.82s · Buồn ngủ", en: "Eyes closed 1.82s · Drowsy" },
    earClosureSec: 1.82,
    hornActive: true,
    guardrailTriggered: true,
    guardrailNote: {
      vi: "Người lái mất tỉnh táo → Khóa đề xuất lái tiếp tới garage xa",
      en: "Driver drowsy → Blocks proposing a drive to a distant garage",
    },
    activeTools: ["weather", "history", "garages"],
    planCode: "stop_rest_and_get_help",
    planTitle: {
      vi: "Tấp vào nơi an toàn nghỉ ngơi trước · Tạm khóa đặt lịch",
      en: "Pull over safely to rest first · Garage booking withheld",
    },
    planSummary: {
      vi: "Camera phát hiện nhắm mắt 1.82 giây ở tốc độ 65 km/h khi máy đang ấm (107.2°C). Còi biên kích hoạt tức thì (< 50 ms), ép gửi lô 5 mẫu sớm và chuyển phương án sang dừng nghỉ an toàn.",
      en: "Camera detects 1.82s eye closure at 65 km/h with a warm engine (107.2°C). Edge horn sounds in < 50 ms, early 5-sample flush fires, and plan switches to a safe rest stop.",
    },
    voiceLine: {
      vi: "“Nguy hiểm! Phát hiện dấu hiệu buồn ngủ khi nhiệt độ máy đang tăng. Hãy tấp vào vị trí an toàn gần nhất để nghỉ ngơi ngay.”",
      en: "“Critical alert! Drowsiness detected while engine temperature is rising. Pull over at the nearest safe spot to rest immediately.”",
    },
    bookingAllowed: false,
  },
};

export default function WorkflowPage() {
  const { t, lang } = useLang();
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("overheat");
  const [activeStage, setActiveStage] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(true);
  const [pulseTick, setPulseTick] = useState<number>(0);

  const sc = SCENARIOS[scenarioKey];

  useEffect(() => {
    if (!playing) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const timer = setInterval(() => {
      setActiveStage((prev) => (prev + 1) % 5);
    }, 3800);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const timer = setInterval(() => {
      setPulseTick((prev) => (prev + 1) % 15);
    }, 800);
    return () => clearInterval(timer);
  }, []);

  const stages = [
    {
      index: 0,
      code: "01",
      latency: "1 Hz · 12 fps",
      title: t("Thu nhận Tín hiệu Kép tại Biên", "Dual-Stream Edge Acquisition"),
      subtitle: t("ECU Blackbox + Camera Trình duyệt", "ECU Blackbox + Browser Camera"),
      module: "live-telemetry.ts · garage-camera.tsx",
      description: t(
        "Hai luồng dữ liệu độc lập vận hành song song: Blackbox đọc 12 kênh động cơ và nhiệt độ mỗi giây (1 Hz), trong khi MediaPipe FaceLandmarker đo tỷ lệ mở mắt (EAR) ở tốc độ 12 fps ngay trên trình duyệt mà không truyền bất kỳ khung hình video nào ra ngoài.",
        "Two independent streams operate in parallel: the Blackbox samples 12 engine and thermal channels every second (1 Hz), while MediaPipe FaceLandmarker measures eye opening (EAR) at 12 fps inside the browser with zero video frames leaving the device.",
      ),
      payloadTitle: "01 · Edge Telemetry & Landmark Summary",
      payload: JSON.stringify(
        {
          ecu_sample_1hz: {
            vehicleId: "bmw-m2",
            rpm: sc.rpm,
            speed_kmh: sc.speed,
            coolant_c: sc.coolant,
            engineLoad_pct: sc.load,
            fan_pct: sc.fan,
          },
          driver_camera_12fps: {
            processedInBrowser: true,
            rawFramesUploaded: 0,
            longestEyeClosureSec: sc.earClosureSec,
            driverState: sc.earClosureSec >= 1.5 ? "drowsy" : "attentive",
          },
        },
        null,
        2,
      ),
    },
    {
      index: 1,
      code: "02",
      latency: t("< 50 ms · Lô 5–15 mẫu", "< 50 ms · 5–15 sample batch"),
      title: t("Đóng gói Whitelist & Phản xạ Biên", "Whitelist Batching & Edge Reflex"),
      subtitle: t("Làm sạch dữ liệu + Còi biên tức thì", "Data sanitization + Local horn"),
      module: "batch-stream.ts · guardian-policy.ts",
      description: t(
        "Bộ đệm gom 15 mẫu chuẩn cho mỗi chu kỳ phân tích, hoặc tự động rút ngắn xuống 5 mẫu khi chuyển kịch bản hay khi phát hiện bất thường. Đồng thời, bộ luật Guardian tại biên kết hợp Tốc độ × Nhiệt độ × Độ mở mắt để kích hoạt còi cảnh báo dưới 50 ms mà không cần chờ mạng.",
        "The buffer collects 15 validated samples per cycle, or shortens to 5 samples on scenario transitions and alerts. Simultaneously, the on-device Guardian rule combines Speed × Coolant × Eye Closure to sound the local horn in under 50 ms without waiting for the network.",
      ),
      payloadTitle: "02 · Sanitized Batch & Edge Guardian Status",
      payload: JSON.stringify(
        {
          schemaVersion: 1,
          vehicleId: "bmw-m2",
          sampleIntervalMs: 1000,
          recordCount: sc.batchSize,
          earlyFlushTriggered: sc.batchSize === 5,
          strippedFields: ["fault", "scenario", "analysis"],
          edgeGuardian: {
            localHornActive: sc.hornActive,
            reflexLatencyMs: 18,
          },
        },
        null,
        2,
      ),
    },
    {
      index: 2,
      code: "03",
      latency: t("< 5 ms · Tất định", "< 5 ms · Deterministic"),
      title: t("Chốt chặn An toàn Vật lý", "Deterministic Safety Floor"),
      subtitle: t("Khóa trần mức độ nguy hiểm", "Immutable severity floor"),
      module: "backend/agent/safety.py",
      description: t(
        "Trước khi gọi mô hình ngôn ngữ lớn, tầng luật cứng tại Backend kiểm tra các ngưỡng vật lý bất biến (nhiệt độ nước làm mát ≥ 120°C hoặc tốc độ tăng nhiệt cao khi quạt = 0%). Khi chốt chặn này kích hoạt, mức độ cảnh báo tối thiểu bị khóa cứng — AI không thể tự ý hạ cấp rủi ro.",
        "Before invoking the LLM, the backend's deterministic safety layer evaluates physical invariants (coolant ≥ 120°C or rapid heating while fan = 0%). When triggered, the minimum severity is locked—the AI model cannot downgrade the risk.",
      ),
      payloadTitle: "03 · HardSafetyGuardrail Verdict",
      payload: JSON.stringify(
        {
          hard_safety_guardrail: {
            triggered: sc.guardrailTriggered,
            lockedMinimumSeverity:
              sc.tone === "critical" ? "critical" : sc.tone === "watch" ? "warning" : "normal",
            coolant_c: sc.coolant,
            fan_pct: sc.fan,
            heatingRate: sc.trend[lang],
            llmDowngradePermitted: false,
          },
        },
        null,
        2,
      ),
    },
    {
      index: 3,
      code: "04",
      latency: t("4 Công cụ Thời gian thực", "4 Live Tools"),
      title: t("Suy luận Đa tín hiệu & Gọi Công cụ", "Multi-Signal Reasoning & Live Tools"),
      subtitle: t("Thời tiết · Hồ sơ · Bản đồ · Đặt lịch", "Weather · History · Maps · Booking"),
      module: "backend/agent/orchestrator.py · tools.py",
      description: t(
        "Agent phân tích độ dốc biến thiên của chuỗi mẫu và chủ động gọi 4 công cụ thực: (1) Open-Meteo lấy nhiệt độ môi trường tại GPS xe, (2) Lịch sử bảo dưỡng để kiểm tra lỗi tái phát, (3) LocationIQ / OpenStreetMap tìm garage trong 5 km, và (4) Khởi tạo phiếu đề xuất lịch hẹn.",
        "The Agent analyses the time-series slope and invokes 4 live tools: (1) Open-Meteo ambient weather at the car's GPS, (2) Maintenance history for recurring faults, (3) LocationIQ / OpenStreetMap garages within 5 km, and (4) Service appointment proposal.",
      ),
      payloadTitle: "04 · Orchestrator Tool Trace",
      payload: JSON.stringify(
        {
          tool_calls: sc.activeTools.map((tool) =>
            tool === "weather"
              ? { tool: "get_external_environment_context", ambient_c: sc.ambient, status: "ok" }
              : tool === "history"
                ? {
                    tool: "get_vehicle_maintenance_history",
                    recurring_cooling_fault: sc.id === "overheat",
                    status: "ok",
                  }
                : tool === "garages"
                  ? { tool: "search_nearby_garages", radius_km: 5, candidates: 5, status: "ok" }
                  : { tool: "propose_service_appointment", state: "awaiting_user_consent" },
          ),
        },
        null,
        2,
      ),
    },
    {
      index: 4,
      code: "05",
      latency: t("Blaze TTS · Xác nhận Kép", "Blaze TTS · Consent Gate"),
      title: t("Hợp nhất Phương án Xe × Tài xế", "Combined Car × Driver Action Plan"),
      subtitle: t("Phát giọng nói & Cổng xác nhận đặt lịch", "Voice synthesis & Consent gate"),
      module: "backend/agent/plan.py · voice.py",
      description: t(
        "Bộ tổng hợp phương án (Plan Synthesizer) ghép kết luận kỹ thuật của Xe với trạng thái tỉnh táo của Tài xế. Nếu xe nóng nhưng người lái buồn ngủ, hệ thống TỪ CHỐI đặt lịch đi xa và yêu cầu tấp vào nghỉ ngơi trước; đồng thời phát giọng nói Blaze TTS và mở đàm thoại “Hey Neuron”.",
        "The Plan Synthesizer merges the Vehicle Assessment with Driver Alertness. If the car runs warm while the driver is drowsy, it WITHHOLDS distant garage booking and prioritizes a safe rest stop first, while streaming Blaze TTS voice and enabling “Hey Neuron” talk.",
      ),
      payloadTitle: "05 · Synthesized Safety Plan & Voice Dispatch",
      payload: JSON.stringify(
        {
          combined_plan: {
            code: sc.planCode,
            vehicleSeverity:
              sc.tone === "ok" ? "normal" : sc.tone === "watch" ? "warning" : "critical",
            driverAlertness: sc.earClosureSec >= 1.5 ? "drowsy" : "attentive",
            bookingProposalAllowed: sc.bookingAllowed,
          },
          voice_dispatch: {
            engine: "Blaze Multilingual TTS",
            spokenOncePerIncident: sc.tone !== "ok",
            script: sc.voiceLine[lang],
          },
        },
        null,
        2,
      ),
    },
  ];

  const currentStage = stages[activeStage];
  const filledCells = (pulseTick % sc.batchSize) + 1;

  return (
    <div className={styles.page}>
      <SiteHeader current="workflow" />

      <main className={styles.main}>
        {/* ── CHƯƠNG 1: ĐẶT VẤN ĐỀ & CHỈ SỐ ĐỊNH LƯỢNG (Huashu Editorial Header + Metric Strip) ── */}
        <section className={styles.editorialSection}>
          <div className={styles.headerSplit}>
            <div>
              <div className={styles.kicker}>
                {t("KIẾN TRÚC HỆ THỐNG & DÒNG CHẢY DỮ LIỆU", "SYSTEM ARCHITECTURE & DATA WORKFLOW")}
              </div>
              <h1 className={styles.title}>
                {t(
                  "Năm Giai đoạn Hợp nhất Cảm biến Biên và Trí tuệ Nhân tạo",
                  "Five Stages Uniting Edge Telemetry and Agentic Reasoning",
                )}
              </h1>
            </div>
            <p className={styles.lead}>
              {t(
                "Thay vì dựa vào một ngưỡng nhiệt độ đơn lẻ, Car Neuron kết hợp dòng dữ liệu động cơ 1 Hz với thị giác máy tính 12 fps ngay trên trình duyệt, đi qua chốt chặn vật lý tất định trước khi điều phối 4 công cụ thực tế.",
                "Rather than relying on a single temperature threshold, Car Neuron fuses 1 Hz engine telemetry with 12 fps in-browser computer vision, passing through a deterministic safety floor before orchestrating 4 live tools.",
              )}
            </p>
          </div>

          <hr className={styles.rule} />

          {/* Mẫu 5 Huashu: Chỉ số Định lượng Nổi bật (Metric Impact Strip) */}
          <div className={styles.metricStrip}>
            <div className={styles.metricCard}>
              <span className={styles.idx}>{t("01 · TẦN SỐ THU NHẬN", "01 · SAMPLING CADENCE")}</span>
              <div className={styles.val}>1 Hz + 12 fps</div>
              <p className={styles.txt}>
                {t(
                  "Đồng bộ 12 kênh cảm biến OBD-II mỗi giây và 478 điểm mốc khuôn mặt tài xế ngay tại trình duyệt.",
                  "Synchronizes 12 OBD-II channels every second with 478 facial landmarks processed locally in the browser.",
                )}
              </p>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.idx}>{t("02 · ĐỘ TRỄ PHẢN XẠ BIÊN", "02 · EDGE REFLEX LATENCY")}</span>
              <div className={styles.val}>&lt; 50 ms</div>
              <p className={styles.txt}>
                {t(
                  "Luật Guardian tại biên phát còi cảnh báo tức thì khi tài xế nhắm mắt mà không cần chờ phản hồi mạng.",
                  "On-device Guardian rules trigger the warning horn immediately on eye closure without waiting for network round-trips.",
                )}
              </p>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.idx}>{t("03 · CHỐT CHẶN VẬT LÝ", "03 · PHYSICAL SAFETY FLOOR")}</span>
              <div className={styles.val}>120.0°C</div>
              <p className={styles.txt}>
                {t(
                  "Ngưỡng luật cứng bất biến tại Backend: tự động khóa trần mức độ nguy hiểm, ngăn AI hạ thấp rủi ro.",
                  "Immutable backend safety floor: locks minimum critical severity and prevents the LLM from downgrading risk.",
                )}
              </p>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.idx}>{t("04 · QUYỀN RIÊNG TƯ", "04 · PRIVACY GUARANTEE")}</span>
              <div className={styles.val}>0 Frame</div>
              <p className={styles.txt}>
                {t(
                  "Không có bất kỳ khung hình camera nào rời khỏi thiết bị; chỉ gửi tóm tắt trạng thái và gói 17 trường sạch.",
                  "Zero raw camera frames ever leave the device; only state summaries and 17 whitelisted telemetry fields are sent.",
                )}
              </p>
            </div>
          </div>
        </section>

        {/* ── CHƯƠNG 2: BẢN VẼ ĐỘNG QUY TRÌNH 5 GIAI ĐOẠN (Huashu Kinetic Schematic) ── */}
        <section
          className={styles.schematicSection}
          data-tone={sc.tone}
          aria-label={t("Sơ đồ dòng chảy kiến trúc Car Neuron", "Car Neuron architecture flow diagram")}
        >
          <div className={styles.schematicHeader}>
            <div>
              <div className={styles.kicker}>{sc.kicker[lang]}</div>
              <h2 className={styles.sectionTitle}>
                {t("Bản vẽ Động Luồng Xử lý Thời gian thực", "Interactive Real-Time Pipeline Schematic")}
              </h2>
            </div>

            <div className={styles.controlsBar}>
              <div className={styles.scenarioGroup} role="tablist" aria-label={t("Chọn kịch bản", "Select scenario")}>
                {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
                  const item = SCENARIOS[key];
                  const active = key === scenarioKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-tone={item.tone}
                      className={`${styles.scenarioBtn} ${active ? styles.scenarioBtnActive : ""}`}
                      onClick={() => setScenarioKey(key)}
                    >
                      <span className={styles.scenarioIdx}>{item.index}</span>
                      <span>{item.label[lang]}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className={styles.playBtn}
                onClick={() => setPlaying((p) => !p)}
                aria-pressed={playing}
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
                <span>{playing ? t("Đang chạy tuần tự", "Auto-stepping") : t("Tạm dừng", "Paused")}</span>
              </button>
            </div>
          </div>

          <hr className={styles.rule} />

          {/* Thanh tiến trình 5 bước chuẩn Mẫu 3 Huashu (Horizontal Flow Strip) */}
          <div className={styles.stageStrip}>
            {stages.map((st, i) => {
              const isCurrent = i === activeStage;
              const isPast = i < activeStage;
              return (
                <button
                  key={st.code}
                  type="button"
                  className={`${styles.stageStep} ${isCurrent ? styles.stageStepCurrent : ""} ${isPast ? styles.stageStepPast : ""}`}
                  onClick={() => {
                    setActiveStage(i);
                    setPlaying(false);
                  }}
                >
                  <div className={styles.stageStepTop}>
                    <span className={styles.stageCode}>{st.code}</span>
                    <span className={styles.stageLatency}>{st.latency}</span>
                  </div>
                  <div className={styles.stageName}>{st.title}</div>
                  <div className={styles.stageSub}>{st.subtitle}</div>
                </button>
              );
            })}
          </div>

          {/* Sân khấu Bản vẽ Kỹ thuật Sáng (Ink-on-Paper Kinetic Canvas) */}
          <div className={styles.canvasBoard}>
            {/* Lớp đường mạch kỹ thuật SVG với hạt xung mực/đất nung chạy mượt */}
            <svg
              className={styles.schematicSvg}
              viewBox="0 0 1200 420"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {/* Đường chỉ dẫn nền (Paper Rule Lines) */}
              <g className={styles.svgGuides}>
                <path d="M 250 115 C 295 115, 295 125, 340 125" pathLength="1" />
                <path d="M 250 305 C 295 305, 295 305, 340 305" pathLength="1" />
                <path d="M 455 245 L 455 185" pathLength="1" strokeDasharray="4 4" />
                <path d="M 565 125 C 610 125, 610 190, 655 190" pathLength="1" />
                <path d="M 565 305 C 610 305, 610 235, 655 235" pathLength="1" />
                <path d="M 885 190 C 920 190, 920 125, 955 125" pathLength="1" />
                <path d="M 885 235 C 920 235, 920 305, 955 305" pathLength="1" />
              </g>

              {/* Xung tín hiệu động (Kinetic Ink Pulses) */}
              <g className={styles.svgPulses}>
                <path
                  className={styles.inkPulseFast}
                  d="M 250 115 C 295 115, 295 125, 340 125"
                  pathLength="1"
                />
                <path
                  className={styles.inkPulseFast}
                  style={{ animationDelay: "350ms" }}
                  d="M 250 305 C 295 305, 295 305, 340 305"
                  pathLength="1"
                />
                {sc.hornActive && (
                  <path className={styles.inkPulseAlert} d="M 455 245 L 455 185" pathLength="1" />
                )}
                <path
                  className={styles.inkPulseMed}
                  style={{ animationDelay: "500ms" }}
                  d="M 565 125 C 610 125, 610 190, 655 190"
                  pathLength="1"
                />
                <path
                  className={styles.inkPulseMed}
                  style={{ animationDelay: "700ms" }}
                  d="M 565 305 C 610 305, 610 235, 655 235"
                  pathLength="1"
                />
                <path
                  className={styles.inkPulseMed}
                  style={{ animationDelay: "950ms" }}
                  d="M 885 190 C 920 190, 920 125, 955 125"
                  pathLength="1"
                />
                <path
                  className={styles.inkPulseMed}
                  style={{ animationDelay: "1200ms" }}
                  d="M 885 235 C 920 235, 920 305, 955 305"
                  pathLength="1"
                />
              </g>
            </svg>

            {/* Lưới 4 cột Trạm Kiến trúc (Architectural Stations) */}
            <div className={styles.stationGrid}>
              {/* CỘT 1: CẢM BIẾN BIÊN */}
              <div className={styles.stationCol}>
                <div className={styles.colLabel}>{t("01 · CẢM BIẾN TẠI BIÊN", "01 · EDGE SENSING")}</div>

                <article
                  className={`${styles.stationCard} ${activeStage === 0 ? styles.cardActive : ""}`}
                  onClick={() => {
                    setActiveStage(0);
                    setPlaying(false);
                  }}
                >
                  <div className={styles.cardTopRow}>
                    <span className={styles.cardIdx}>1A · OBD-II / CAN</span>
                    <span className={styles.tagMono}>{t("1 Hz · 12 kênh", "1 Hz · 12 channels")}</span>
                  </div>
                  <div className={styles.ct}>{t("Dòng dữ liệu Blackbox", "Blackbox Telemetry")}</div>
                  <div className={styles.dataGrid3}>
                    <div>
                      <span>{t("Nước làm mát", "Coolant")}</span>
                      <strong data-tone={sc.tone}>{sc.coolant.toFixed(1)}°C</strong>
                    </div>
                    <div>
                      <span>{t("Quạt · Tải", "Fan · Load")}</span>
                      <strong>
                        {sc.fan}% · {sc.load}%
                      </strong>
                    </div>
                    <div>
                      <span>{t("Tốc độ", "Speed")}</span>
                      <strong>{sc.speed} km/h</strong>
                    </div>
                  </div>
                  <div className={styles.thermalTrack} aria-hidden="true">
                    <div
                      className={styles.thermalFill}
                      data-tone={sc.tone}
                      style={{ width: `${Math.min(100, Math.max(18, (sc.coolant - 80) * 2.2))}%` }}
                    />
                  </div>
                </article>

                <article
                  className={`${styles.stationCard} ${activeStage === 0 ? styles.cardActive : ""} ${sc.hornActive ? styles.cardWarn : ""}`}
                  onClick={() => {
                    setActiveStage(0);
                    setPlaying(false);
                  }}
                >
                  <div className={styles.cardTopRow}>
                    <span className={styles.cardIdx}>{t("1B · THỊ GIÁC MÁY TÍNH", "1B · COMPUTER VISION")}</span>
                    <span className={styles.tagMono}>{t("12 fps · Trình duyệt", "12 fps · In-Browser")}</span>
                  </div>
                  <div className={styles.ct}>{t("Camera Giám sát Tài xế", "Driver Attention Camera")}</div>
                  <div className={styles.dataGrid2}>
                    <div>
                      <span>{t("Trạng thái", "State")}</span>
                      <strong data-tone={sc.hornActive ? "critical" : "ok"}>{sc.driverState[lang]}</strong>
                    </div>
                    <div>
                      <span>{t("Nhắm mắt lâu nhất", "Max eye closure")}</span>
                      <strong>{sc.earClosureSec.toFixed(2)} s</strong>
                    </div>
                  </div>
                  <div className={styles.cardNote}>
                    {t("Xử lý nội bộ 100% — không tải ảnh/video lên máy chủ", "100% in-browser — zero raw video uploaded")}
                  </div>
                </article>
              </div>

              {/* CỘT 2: CỔNG KIỂM DUYỆT & PHẢN XẠ BIÊN */}
              <div className={styles.stationCol}>
                <div className={styles.colLabel}>{t("02 · ĐÓNG GÓI & LUẬT BIÊN", "02 · BATCHING & EDGE POLICY")}</div>

                <article
                  className={`${styles.stationCard} ${activeStage === 1 ? styles.cardActive : ""}`}
                  onClick={() => {
                    setActiveStage(1);
                    setPlaying(false);
                  }}
                >
                  <div className={styles.cardTopRow}>
                    <span className={styles.cardIdx}>{t("2A · TRẠM ĐỆM BLACKBOX", "2A · BLACKBOX BUFFER")}</span>
                    <span className={styles.tagMono}>
                      {filledCells}/{sc.batchSize} {t("mẫu", "samples")}
                    </span>
                  </div>
                  <div className={styles.ct}>
                    {sc.batchSize === 5
                      ? t("Xả sớm gói 5 mẫu (Khẩn cấp)", "Early 5-Sample Burst Flush")
                      : t("Gom lô chuẩn 15 mẫu / chu kỳ", "Standard 15-Sample Batching")}
                  </div>
                  <div
                    className={styles.sampleCells}
                    style={{ gridTemplateColumns: `repeat(${sc.batchSize}, 1fr)` }}
                    aria-hidden="true"
                  >
                    {Array.from({ length: sc.batchSize }, (_, i) => (
                      <span key={i} className={i < filledCells ? styles.cellActive : ""} />
                    ))}
                  </div>
                  <div className={styles.cardNote}>
                    {t("Giữ 17 trường hợp lệ · Loại bỏ nhãn giả lập trước khi gửi", "Whitelists 17 fields · Strips simulation labels")}
                  </div>
                </article>

                <article
                  className={`${styles.stationCard} ${activeStage === 1 ? styles.cardActive : ""} ${sc.hornActive ? styles.cardWarn : ""}`}
                  onClick={() => {
                    setActiveStage(1);
                    setPlaying(false);
                  }}
                >
                  <div className={styles.cardTopRow}>
                    <span className={styles.cardIdx}>2B · GUARDIAN POLICY</span>
                    <span className={styles.tagMono}>&lt; 50 ms</span>
                  </div>
                  <div className={styles.ct}>{t("Phản xạ An toàn tại Thiết bị", "On-Device Safety Reflex")}</div>
                  <p className={styles.txtSmall}>
                    {sc.hornActive
                      ? t(
                          "Còi WebAudio 880 Hz phát tức thì + gọi lệnh flushNow() ép gửi gói mẫu ngay lập tức.",
                          "880 Hz WebAudio horn sounds immediately + calls flushNow() for instant batch dispatch.",
                        )
                      : t(
                          "Người lái mở mắt bình thường · Còi cảnh báo biên giữ trạng thái yên lặng.",
                          "Driver eyes open normally · Local warning horn remains silent.",
                        )}
                  </p>
                </article>
              </div>

              {/* CỘT 3: CHỐT CHẶN VẬT LÝ & ĐIỀU PHỐI AGENT */}
              <div className={styles.stationCol}>
                <div className={styles.colLabel}>{t("03 & 04 · LUẬT CỨNG & AI AGENT", "03 & 04 · SAFETY FLOOR & AI AGENT")}</div>

                <article
                  className={`${styles.stationCard} ${styles.orchestratorCard} ${activeStage === 2 || activeStage === 3 ? styles.cardActive : ""}`}
                  onClick={() => {
                    setActiveStage(activeStage === 2 ? 3 : 2);
                    setPlaying(false);
                  }}
                >
                  {/* Tầng 03: Hard Safety Guardrail */}
                  <div className={styles.guardrailBox} data-triggered={sc.guardrailTriggered || undefined}>
                    <div className={styles.cardTopRow}>
                      <span className={styles.cardIdx}>03 · HARD SAFETY GUARDRAIL</span>
                      <span className={styles.tagMono}>safety.py</span>
                    </div>
                    <strong>
                      {sc.guardrailTriggered
                        ? t("KHÓA TRẦN NGUY HIỂM (AI không được hạ cấp)", "CRITICAL FLOOR LOCKED (No AI downgrade)")
                        : t("ĐẠT KIỂM ĐỊNH VẬT LÝ", "PHYSICAL INVARIANTS PASSED")}
                    </strong>
                    <small>{sc.guardrailNote[lang]}</small>
                  </div>

                  {/* Tầng 04: Car Neuron Orchestrator + 4 Tools */}
                  <div className={styles.orchestratorBody}>
                    <div className={styles.cardTopRow}>
                      <span className={styles.cardIdx}>04 · CAR NEURON ORCHESTRATOR</span>
                      <span className={styles.tagMono}>{sc.trend[lang]}</span>
                    </div>
                    <div className={styles.ct}>{t("Đối chiếu Chuỗi thời gian & 4 Công cụ", "Time-Series & 4-Tool Synthesis")}</div>

                    <div className={styles.toolTable}>
                      <div className={styles.toolRow} data-active={sc.activeTools.includes("weather") || undefined}>
                        <span className={styles.toolCode}>01 · Open-Meteo</span>
                        <span className={styles.toolVal}>{sc.ambient}°C {t("ngoài trời", "ambient")}</span>
                      </div>
                      <div className={styles.toolRow} data-active={sc.activeTools.includes("history") || undefined}>
                        <span className={styles.toolCode}>02 · Service History</span>
                        <span className={styles.toolVal}>
                          {sc.id === "overheat"
                            ? t("Khớp lỗi quạt cũ", "Prior fan fault")
                            : t("Đã đối chiếu", "Checked")}
                        </span>
                      </div>
                      <div className={styles.toolRow} data-active={sc.activeTools.includes("garages") || undefined}>
                        <span className={styles.toolCode}>03 · LocationIQ Maps</span>
                        <span className={styles.toolVal}>
                          {sc.activeTools.includes("garages") ? t("5 garage (< 5 km)", "5 garages (< 5 km)") : "—"}
                        </span>
                      </div>
                      <div className={styles.toolRow} data-active={sc.activeTools.includes("booking") || undefined}>
                        <span className={styles.toolCode}>04 · Booking Proposal</span>
                        <span className={styles.toolVal}>
                          {sc.bookingAllowed
                            ? t("Chờ xác nhận", "Pending consent")
                            : sc.id === "drowsy_warm"
                              ? t("Đã khóa (ưu tiên nghỉ)", "Locked (rest first)")
                              : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              </div>

              {/* CỘT 4: PHƯƠNG ÁN HỢP NHẤT & GIỌNG NÓI */}
              <div className={styles.stationCol}>
                <div className={styles.colLabel}>{t("05 · PHƯƠNG ÁN & ĐÀM THOẠI", "05 · ACTION PLAN & VOICE")}</div>

                <article
                  className={`${styles.stationCard} ${activeStage === 4 ? styles.cardActive : ""}`}
                  data-tone={sc.tone}
                  onClick={() => {
                    setActiveStage(4);
                    setPlaying(false);
                  }}
                >
                  <div className={styles.cardTopRow}>
                    <span className={styles.cardIdx}>{t("5A · KẾT LUẬN HỢP NHẤT", "5A · COMBINED VERDICT")}</span>
                    <code className={styles.planBadge}>{sc.planCode}</code>
                  </div>
                  <div className={styles.ct}>{sc.planTitle[lang]}</div>
                  <p className={styles.txtSmall}>{sc.planSummary[lang]}</p>
                </article>

                <article
                  className={`${styles.stationCard} ${activeStage === 4 ? styles.cardActive : ""}`}
                  onClick={() => {
                    setActiveStage(4);
                    setPlaying(false);
                  }}
                >
                  <div className={styles.cardTopRow}>
                    <span className={styles.cardIdx}>5B · BLAZE TTS &amp; CONSENT GATE</span>
                    <span className={styles.tagMono}>VI / EN</span>
                  </div>
                  <blockquote className={styles.quoteBox}>{sc.voiceLine[lang]}</blockquote>
                  <div className={styles.cardNote}>
                    {sc.bookingAllowed
                      ? t("✓ Mở phiếu Xác nhận Đặt lịch (.ics) trên giao diện", "✓ Opens Confirm Booking Card (.ics) in UI")
                      : sc.id === "drowsy_warm"
                        ? t("✕ Tạm ẩn đặt lịch để người lái dừng nghỉ an toàn", "✕ Withholds booking so driver rests safely first")
                        : t("• Không tự động đặt lịch khi xe vận hành bình thường", "• No booking proposed during normal operation")}
                  </div>
                </article>
              </div>
            </div>
          </div>

          {/* Mẫu 2 Huashu: Phân tách 2 cột Chi tiết Giai đoạn & Hồ sơ JSON */}
          <div className={styles.inspectorSplit}>
            <div className={styles.inspectorLeft}>
              <div className={styles.inspectorMeta}>
                <span className={styles.idx}>
                  {t("GIAI ĐOẠN", "STAGE")} {currentStage.code} / 05
                </span>
                <span className={styles.modulePath}>{currentStage.module}</span>
              </div>
              <h3 className={styles.inspectorHeading}>{currentStage.title}</h3>
              <p className={styles.txt}>{currentStage.description}</p>
            </div>

            <div className={styles.inspectorRight}>
              <div className={styles.codeBar}>
                <span>{currentStage.payloadTitle}</span>
                <span>{sc.kicker[lang]}</span>
              </div>
              <pre className={styles.codePre}>
                <code>{currentStage.payload}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* ── CHƯƠNG 3: BẢNG SỐ LIỆU ĐỐI CHIẾU QUYẾT ĐỊNH KÉP (Mẫu 4 Huashu: Evidence Data Table) ── */}
        <section className={styles.editorialSection}>
          <div className={styles.kicker}>
            {t("MA TRẬN QUYẾT ĐỊNH HỢP NHẤT (XE × TÀI XẾ)", "COMBINED CAR × DRIVER DECISION MATRIX")}
          </div>
          <h2 className={styles.sectionTitle}>
            {t(
              "Cùng một chiếc xe nóng máy, nhưng hai phương án an toàn khác biệt hoàn toàn",
              "The Same Warm Engine Produces Two Distinct Safety Plans",
            )}
          </h2>
          <hr className={styles.rule} />

          <div className={styles.tableWrap}>
            <table className={styles.evidenceTable}>
              <thead>
                <tr>
                  <th>{t("Tình huống Thực nghiệm", "Scenario")}</th>
                  <th>{t("Tín hiệu Động cơ (1 Hz)", "Vehicle Telemetry (1 Hz)")}</th>
                  <th>{t("Trạng thái Tài xế (12 fps)", "Driver Alertness (12 fps)")}</th>
                  <th>{t("Mã Phương án Hợp nhất", "Synthesized Plan Code")}</th>
                  <th>{t("Quyết định Đặt lịch & Hành động", "Booking & Safety Action")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{t("01 · Nắng nóng ngoài trời", "01 · Hot Afternoon")}</strong>
                  </td>
                  <td>{t("101.8°C · Quạt 85% · Thời tiết 38°C", "101.8°C · Fan 85% · Weather 38°C")}</td>
                  <td>{t("Tỉnh táo (Nhắm mắt 0.21s)", "Attentive (Closure 0.21s)")}</td>
                  <td>
                    <code>continue_monitoring</code>
                  </td>
                  <td>
                    {t(
                      "Đối chiếu Open-Meteo, xác nhận quạt hoạt động tốt, loại trừ báo động giả.",
                      "Cross-checks Open-Meteo, confirms fan response, suppresses false alarm.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>{t("02 · Lỗi quạt làm mát", "02 · Cooling Fan Fault")}</strong>
                  </td>
                  <td>{t("115.6°C (+40°C/phút) · Quạt 0%", "115.6°C (+40°C/min) · Fan 0%")}</td>
                  <td>{t("Tỉnh táo (Đang lái 60 km/h)", "Attentive (Driving 60 km/h)")}</td>
                  <td>
                    <code>garage_when_convenient</code>
                  </td>
                  <td>
                    {t(
                      "Cho phép đề xuất 5 garage gần nhất (< 5 km) kèm cổng xác nhận đặt lịch.",
                      "Proposes 5 nearby garages (< 5 km) with explicit user booking confirmation.",
                    )}
                  </td>
                </tr>
                <tr className={styles.highlightRow}>
                  <td>
                    <strong>{t("03 · Máy ấm + Tài xế buồn ngủ", "03 · Warm Car + Drowsy Driver")}</strong>
                  </td>
                  <td>{t("107.2°C (+18°C/phút) · Quạt 20%", "107.2°C (+18°C/min) · Fan 20%")}</td>
                  <td>
                    <strong>{t("Nhắm mắt 1.82s (Buồn ngủ)", "Closure 1.82s (Drowsy)")}</strong>
                  </td>
                  <td>
                    <code>stop_rest_and_get_help</code>
                  </td>
                  <td>
                    <strong>
                      {t(
                        "Phát còi biên < 50 ms · KHÓA đề xuất lái đi garage xa, yêu cầu tấp vào nghỉ trước.",
                        "Sounds < 50 ms edge horn · BLOCKS distant garage booking, requires safe rest stop first.",
                      )}
                    </strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>{t("04 · Quá nhiệt tới hạn", "04 · Critical Overheat")}</strong>
                  </td>
                  <td>
                    <strong>{t("≥ 120.0°C (Luật cứng kích hoạt)", "≥ 120.0°C (Hard guardrail triggered)")}</strong>
                  </td>
                  <td>{t("Mọi trạng thái người lái", "Any driver state")}</td>
                  <td>
                    <code>stop_and_get_help</code>
                  </td>
                  <td>
                    {t(
                      "Chốt chặn vật lý (safety.py) chiếm quyền tối cao: buộc dừng xe an toàn và gọi cứu hộ.",
                      "Hard safety floor (safety.py) overrides all: mandatory safe stop and roadside rescue.",
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.footerCta}>
            <div className={styles.srcNote}>
              {t(
                "Nguồn kiểm chứng: backend/agent/safety.py · backend/agent/plan.py · frontend/src/lib/guardian-policy.ts",
                "Verified modules: backend/agent/safety.py · backend/agent/plan.py · frontend/src/lib/guardian-policy.ts",
              )}
            </div>
            <div className={styles.ctaActions}>
              <Link href="/garage" className="primary-button">
                {t("Thực nghiệm trực tiếp tại Garage", "Test Live in the Garage")} <ArrowRight size={16} />
              </Link>
              <Link href="/film" className="outline-button">
                {t("Xem Phim giới thiệu 90 giây", "Watch 90s Intro Film")}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <Brand label={t("Car Neuron trang chủ", "Car Neuron home")} />
          <span>{t("Ấn bản Kỹ thuật · Kiến trúc An toàn Kép Xe & Người lái.", "Technical Edition · Dual-Stream Vehicle & Driver Safety.")}</span>
        </div>
        <nav aria-label="Footer">
          <Link href="/">{t("Trang chủ", "Home")}</Link>
          <Link href="/garage">Garage</Link>
          <Link href="/driver">{t("Tài xế", "Driver")}</Link>
          <Link href="/film">{t("Phim giới thiệu", "Intro film")}</Link>
          <Link href="/workflow">Workflow</Link>
        </nav>
      </footer>
    </div>
  );
}
