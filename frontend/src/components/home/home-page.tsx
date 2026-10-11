"use client";
import Image from "next/image";
import Link from "next/link";
import {useEffect, useState} from "react";
import {
  Activity, ArrowRight, Check, CloudSun, Database, Fan, FlaskConical, Gauge, Gavel, Layers, MapPin,
  Play, Radio, Server, ShieldAlert, Sparkles, Thermometer, TriangleAlert, Wrench,
} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {overheatCoolant} from "@/lib/live-telemetry";
import SiteHeader from "../site/site-header";
import Brand from "../site/brand";
import OverheatChart from "./overheat-chart";
import Reveal from "./reveal";
import styles from "./home.module.css";

// Loops the first 30 s of the overheating ramp (95 → 115°C) as an illustration.
function useHeroTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (!reduced.matches && !document.hidden) timer = setInterval(() => setTick(value => (value + 1) % 31), 1000);
    };
    sync();
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {clearInterval(timer); reduced.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync);};
  }, []);
  return tick;
}

export default function HomePage() {
  const {t} = useLang();
  const tick = useHeroTick();
  const {coolant, trendPerMinute} = overheatCoolant(tick);
  const level = coolant >= 110 ? "hot" : coolant >= 102 ? "warm" : "ok";

  const steps = [
    {icon: <Radio size={20} />, title: t("Blackbox 1 Hz", "1 Hz blackbox"), body: t("Mỗi giây một bản ghi: vòng tua, tải động cơ, nước làm mát, quạt, tốc độ, điện áp và GPS.", "One record per second: RPM, engine load, coolant, fan, speed, voltage and GPS.")},
    {icon: <Layers size={20} />, title: t("Gom lô 15 mẫu", "15-sample batches"), body: t("Lô gửi qua gateway Next.js. Khi đổi kịch bản, lô đầu chỉ cần 5 mẫu để agent phản ứng nhanh.", "Batches go through the Next.js gateway. After a scenario change the first batch closes at 5 samples.")},
    {icon: <ShieldAlert size={20} />, title: t("Luật an toàn + agent", "Safety rule + agent"), body: t("Backend chạy luật cứng (≥ 120°C là nguy hiểm), rồi agent gọi tool: thời tiết, lịch sử bảo dưỡng, garage gần xe.", "The backend applies a hard rule (≥ 120°C is critical), then the agent calls tools: weather, service history, nearby garages.")},
    {icon: <Gavel size={20} />, title: t("Kết luận có bằng chứng", "Explained verdict"), body: t("Mức độ, độ tin cậy tự đánh giá, bằng chứng, đề xuất và từng bước agent đã làm.", "Severity, self-reported confidence, evidence, advice and every step the agent took.")},
  ];
  const cases = [
    {tone: "ok", icon: <CloudSun size={18} />, title: t("Trời nắng 38°C", "A 38°C afternoon"), signals: [t("Nước làm mát cao nhưng ổn định", "Coolant high but steady"), t("Quạt chạy mạnh", "Fan running hard"), t("Nhiệt ngoài trời cao (Open-Meteo)", "Hot outside (Open-Meteo)")], verdict: t("Theo dõi", "Keep watching")},
    {tone: "ok", icon: <Gauge size={18} />, title: t("Leo dốc, tải nặng", "Climbing, heavy load"), signals: [t("Nhiệt tăng cùng tải động cơ", "Heat rises with engine load"), t("Quạt phản ứng", "Fan responds"), t("Giảm tải thì nhiệt giảm", "Heat drops with load")], verdict: t("Bình thường", "Normal")},
    {tone: "alert", icon: <Fan size={18} />, title: t("Quạt không chạy", "The fan stays off"), signals: [t("Nhiệt tăng ~40°C/phút", "Heat climbing ~40°C/min"), t("Tải phẳng ~36%, xe vẫn chạy 60 km/h", "Flat ~36% load, still at 60 km/h"), t("Quạt 0%", "Fan at 0%")], verdict: t("Cảnh báo sớm", "Early warning")},
  ];

  return (
    <div className={styles.page}>
      <SiteHeader current="home" />
      <main>
        {/* Hero */}
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}><span className={styles.eyebrowDot} />{t("Agent sức khỏe xe", "Vehicle health agent")}</span>
            <h1><span className={styles.heroLine}><span>{t("Biết xe nóng máy", "Know your engine is overheating")}</span></span>{" "}<span className={styles.heroLine}><em>{t("trước khi đèn báo sáng.", "before the warning light does.")}</em></span></h1>
            <p className={styles.lead}>{t("Car Neuron đọc dữ liệu blackbox mỗi giây, đối chiếu nhiều cảm biến với thời tiết và lịch sử bảo dưỡng, rồi giải thích vì sao chiếc xe cần được kiểm tra.", "Car Neuron reads blackbox data every second, cross-checks several sensors against the weather and service history, then explains why the car needs a check.")}</p>
            <div className={styles.heroActions}>
              <Link href="/garage" className="primary-button">{t("Mở garage", "Open the garage")} <ArrowRight size={16} /></Link>
              <Link href="/film" className="outline-button"><Play size={15} />{t("Xem phim 90 giây", "Watch the 90 s film")}</Link>
            </div>
            <p className={styles.heroNote}><FlaskConical size={14} />{t("Nguồn dữ liệu ECU được mô phỏng. Luật an toàn, agent AI và các công cụ là thật khi chạy cùng backend.", "The ECU data source is simulated. The safety rule, AI agent and tools are real when running with the backend.")}</p>
          </div>
          <div className={styles.heroVisual} aria-label={t("Minh họa: chiếc xe đang nóng dần", "Illustration: the car heating up")} role="img">
            <div className={styles.heroGlow} data-level={level} />
            <svg className={styles.signalFlow} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {["M25 25 V36 Q25 42 32 42 H44 Q50 42 50 49 V85", "M77 27 V36 Q77 42 70 42 H56 Q50 42 50 49 V85", "M82 44 V54 Q82 60 76 60 H56 Q50 60 50 66 V85"].map((d, i) => (
                <g key={d}><path d={d} pathLength="1" /><path key={tick} className={styles.signalPacket} style={{animationDelay: `${i * 100}ms`}} d={d} pathLength="1" /></g>
              ))}
              <circle cx="50" cy="85" r="1.2" />
            </svg>
            <Image className={styles.heroCar} src="/brand/m2-hero.webp" alt="" width={1800} height={802} preload sizes="(max-width: 900px) 100vw, 640px" />
            <div className={`${styles.chip} ${styles.chipCoolant}`} data-level={level}>
              <Thermometer size={16} />
              <span><small>{t("Nước làm mát", "Coolant")}</small><b>{coolant.toFixed(1)}°C</b></span>
              <em>↑ {Math.round(trendPerMinute)}°C/{t("phút", "min")}</em>
            </div>
            <div className={`${styles.chip} ${styles.chipFan}`}>
              <Fan size={16} /><span><small>{t("Quạt làm mát", "Cooling fan")}</small><b>0%</b></span>
            </div>
            <div className={`${styles.chip} ${styles.chipLoad}`}>
              <Gauge size={16} /><span><small>{t("Tải · tốc độ", "Load · speed")}</small><b>36% · 60 km/h</b></span>
            </div>
            <div className={`${styles.chip} ${styles.chipAgent}`} data-active={level !== "ok" || undefined}>
              <Sparkles size={16} />
              <span><small>Car Neuron Agent</small><b>{level === "ok" ? t("Đang theo dõi…", "Monitoring…") : t("Nên kiểm tra hệ thống làm mát", "Check the cooling system")}</b></span>
            </div>
            <span className={styles.heroCaption}>{t("Minh họa theo kịch bản demo", "Illustration of the demo scenario")}</span>
          </div>
        </section>

        {/* Problem */}
        <section className={styles.section}>
          <div className={styles.split}>
            <Reveal className={styles.splitCopy}>
              <span className={styles.kicker}>{t("Vấn đề", "The problem")}</span>
              <h2>{t("Ngưỡng cố định chỉ lên tiếng khi đã quá muộn.", "A fixed threshold speaks up too late.")}</h2>
              <p>{t("Đèn báo nhiệt truyền thống chờ một con số. Khi nước làm mát chạm 120°C, động cơ đã ở vùng nguy hiểm. Nhưng các tín hiệu cùng nhau đã kể câu chuyện từ sớm: nhiệt tăng đều trong khi tải không đổi, xe vẫn chạy và quạt không hề quay.", "A classic temperature light waits for one number. By the time coolant reaches 120°C the engine is already in danger. Yet the signals together told the story much earlier: steady heating at a flat load, the car still moving and the fan never spinning.")}</p>
              <p className={styles.muted}>{t("Biểu đồ là kịch bản quá nhiệt của bản demo (thời gian rút gọn). Mục tiêu là agent cảnh báo trong vùng xanh; thời điểm thực tế còn phụ thuộc độ trễ của mô hình AI.", "The chart is the demo's overheating scenario (compressed time). The goal is a warning inside the green window; the real moment also depends on the AI model's latency.")}</p>
            </Reveal>
            <Reveal className={styles.chartCard} delay={120}>
              <OverheatChart />
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section className={styles.section} id="how">
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>{t("Cách hoạt động", "How it works")}</span>
            <h2>{t("Từ một bản ghi mỗi giây đến một lời khuyên có cơ sở.", "From one record a second to advice you can trust.")}</h2>
          </Reveal>
          <ol className={styles.steps}>
            {steps.map((step, i) => (
              <Reveal as="li" key={step.title} className={styles.step} delay={i * 90}>
                <span className={styles.stepIcon}>{step.icon}</span>
                <span className={styles.stepIndex}>0{i + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Multi-signal reasoning */}
        <section className={styles.section}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>{t("Suy luận đa tín hiệu", "Multi-signal reasoning")}</span>
            <h2>{t("Nóng vì trời, vì tải, hay vì hỏng?", "Hot weather, heavy load, or a fault?")}</h2>
            <p>{t("Cùng một nhiệt độ cao có thể mang ba ý nghĩa khác nhau. Agent đọc nhiều cảm biến cùng lúc thay vì một ngưỡng duy nhất.", "The same high temperature can mean three different things. The agent reads several sensors together instead of a single threshold.")}</p>
          </Reveal>
          <div className={styles.cases}>
            {cases.map((item, i) => (
              <Reveal key={item.title} className={styles.case} delay={i * 90}>
                <div className={styles.caseHead} data-tone={item.tone}>{item.icon}<h3>{item.title}</h3></div>
                <ul>{item.signals.map(signal => <li key={signal}><Activity size={14} />{signal}</li>)}</ul>
                <span className={styles.verdict} data-tone={item.tone}>{item.tone === "alert" ? <TriangleAlert size={14} /> : <Check size={14} />}{item.verdict}</span>
              </Reveal>
            ))}
          </div>
          <p className={styles.footnote}>{t("Ví dụ minh họa cách suy luận, không phải ngưỡng chẩn đoán của nhà sản xuất.", "Illustrative examples of the reasoning, not manufacturer diagnostic limits.")}</p>
        </section>

        {/* Real vs simulated */}
        <section className={styles.section} id="boundary">
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>{t("Minh bạch", "Transparency")}</span>
            <h2>{t("Mô phỏng nguồn dữ liệu. Phía sau là thật.", "Simulated source. Real everything after it.")}</h2>
            <p>{t("Không có sẵn một chiếc xe hỏng để thử, nên dữ liệu ECU được tiêm lỗi có chủ đích, cách làm quen thuộc khi kiểm thử hệ thống chẩn đoán.", "There is no broken car on hand, so ECU data is fault-injected on purpose, a standard way to test diagnostic systems.")}</p>
          </Reveal>
          <div className={styles.boundary}>
            <Reveal className={`${styles.boundaryCol} ${styles.simulated}`}>
              <h3><FlaskConical size={18} />{t("Mô phỏng", "Simulated")}</h3>
              <ul>
                <li><Radio size={15} />{t("Blackbox / ECU và GPS: luồng 1 giây có kịch bản bình thường, nắng nóng, quá nhiệt, mất kết nối", "Blackbox / ECU and GPS: a 1-second stream with normal, hot-weather, overheating and offline scenarios")}</li>
                <li><Wrench size={15} />{t("Lịch sử bảo dưỡng: dữ liệu mẫu seed sẵn cho agent đọc", "Service history: seeded sample records the agent reads")}</li>
                <li><Sparkles size={15} />{t("Chế độ Mô phỏng: agent chạy trong trình duyệt, dùng khi mất mạng lúc demo", "Mock mode: an in-browser agent, a fallback when the network drops")}</li>
              </ul>
            </Reveal>
            <Reveal className={`${styles.boundaryCol} ${styles.real}`} delay={120}>
              <h3><Server size={18} />{t("Thật khi chạy backend", "Real with the backend")}</h3>
              <ul>
                <li><Layers size={15} />{t("Gateway Next.js → FastAPI; khóa API chỉ nằm ở Python", "Next.js gateway → FastAPI; API keys live only in Python")}</li>
                <li><ShieldAlert size={15} />{t("Luật an toàn cứng: nước làm mát ≥ 120°C, điện áp ngoài 10.5–15.5 V", "Hard safety rule: coolant ≥ 120°C, voltage outside 10.5–15.5 V")}</li>
                <li><Sparkles size={15} />{t("Agent OpenAI (mặc định gpt-4.1-mini) gọi tool và trả kết luận có cấu trúc", "OpenAI agent (gpt-4.1-mini by default) calls tools and returns a structured verdict")}</li>
                <li><CloudSun size={15} />{t("Thời tiết Open-Meteo và garage gần xe qua LocationIQ", "Open-Meteo weather and nearby garages via LocationIQ")}</li>
                <li><Database size={15} />{t("SQLite lưu sự cố và bộ nhớ ngắn hạn của agent", "SQLite stores incidents and the agent's short-term memory")}</li>
              </ul>
            </Reveal>
          </div>
        </section>

        {/* Film teaser */}
        <section className={styles.section}>
          <Reveal>
            <Link href="/film" className={styles.filmCard}>
              <div className={styles.filmCopy}>
                <span className={styles.kicker}>{t("Phim giới thiệu", "Intro film")}</span>
                <h2>{t("Toàn bộ câu chuyện trong 90 giây.", "The whole story in 90 seconds.")}</h2>
                <p>{t("Dữ liệu xe, agent và camera tài xế trong một phim giới thiệu có thể tải về.", "Vehicle data, the agent and the driver camera in one downloadable intro film.")}</p>
                <span className={styles.filmPlay}><Play size={16} />{t("Phát phim", "Play the film")}</span>
              </div>
              <div className={styles.filmPoster} aria-hidden="true">
                <div className={styles.filmRoad} />
                <Image src="/brand/m2-side.webp" alt="" width={1600} height={517} className={styles.filmCar} sizes="480px" />
                <span className={styles.filmTemp}>105°C</span>
              </div>
            </Link>
          </Reveal>
        </section>

        {/* CTA */}
        <section className={styles.cta}>
          <Reveal>
            <h2>{t("Sẵn sàng xem agent làm việc?", "Ready to watch the agent work?")}</h2>
            <p>{t("Mở garage, bấm Mô phỏng quá nhiệt và theo dõi agent đọc từng lô dữ liệu.", "Open the garage, press Inject overheating and watch the agent read each batch.")}</p>
            <div className={styles.heroActions}>
              <Link href="/garage" className="primary-button">{t("Mở garage", "Open the garage")} <ArrowRight size={16} /></Link>
            </div>
            <code className={styles.command}>./dev.sh</code>
          </Reveal>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Brand label={t("Car Neuron trang chủ", "Car Neuron home")} />
          <p>
            <MapPin size={13} /> {t("Demo cục bộ, một người dùng. Không phải sản phẩm thương mại.", "Local single-user demo. Not a commercial product.")}
            <br />
            {t("Model 3D", "3D model")}: <a href="https://sketchfab.com/3d-models/2023-bmw-m2-coupe-4bb3ebbb88b04ab6bbb1b95f2aa1c176" target="_blank" rel="noreferrer">2023 BMW M2 Coupe — Outlaw Games™</a>, CC BY-NC 4.0. {t("BMW là thương hiệu của chủ sở hữu; dự án không liên kết với BMW.", "BMW is a trademark of its owner; this project is not affiliated with BMW.")}
          </p>
        </div>
      </footer>
    </div>
  );
}
