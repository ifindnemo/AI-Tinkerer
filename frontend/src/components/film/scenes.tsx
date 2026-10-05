"use client";
import Image from "next/image";
import type {ComponentType, CSSProperties, ReactNode} from "react";
import {
  Activity, Check, CloudSun, Database, Fan, Gauge, Gavel, Layers, ListChecks, Lock, MapPin, MousePointerClick,
  Radio, Server, ShieldAlert, Sparkles, Thermometer, TriangleAlert, Wrench, Zap,
} from "lucide-react";
import {overheatCoolant, overheatSecondAt} from "@/lib/live-telemetry";
import {clamp, ease, lerp, sceneOpacity, span, type SceneId} from "./timeline";
import styles from "./film.module.css";

// Scenes are laid out on a fixed 1920 × 1080 stage that the player scales to fit.
// Every value derives from the scene's local second `t`; numbers follow the demo
// overheating ramp and are labelled as an illustration on the stage.

type Say = (vi: string, en: string) => string;
export type SceneProps = {t: number; d: number; say: Say};

const CAR = {w: 1600, h: 517};
const RULE = 120;
const RULE_AT = overheatSecondAt(RULE);
const EARLY_AT = overheatSecondAt(105);

const px = (value: number) => `${value}px`;
const at = (x: number, y: number, extra?: CSSProperties): CSSProperties => ({left: px(x), top: px(y), ...extra});
const rise = (p: number, distance = 24): CSSProperties => ({opacity: p, transform: `translateY(${(1 - p) * distance}px)`});

function Car({x, ground, width, bob = 0, children}: {x: number; ground: number; width: number; bob?: number; children?: ReactNode}) {
  const height = (width * CAR.h) / CAR.w;
  return (
    <div className={styles.car} style={{left: px(x), top: px(ground - height + bob), width: px(width), height: px(height)}}>
      <span className={styles.carShadow} />
      <Image src="/brand/m2-side.webp" alt="" width={CAR.w} height={CAR.h} sizes="1200px" draggable={false} />
      {children}
    </div>
  );
}
const carPoint = (x: number, ground: number, width: number, ax: number, ay: number) => {
  const height = (width * CAR.h) / CAR.w;
  return {x: x + ax * width, y: ground - height + ay * height};
};

function Road({y, t, speed = 760}: {y: number; t: number; speed?: number}) {
  return (
    <div className={styles.road} style={{top: px(y)}}>
      <span className={styles.roadDash} style={{backgroundPositionX: px(-((t * speed) % 140))}} />
    </div>
  );
}

function Kicker({children, style}: {children: ReactNode; style?: CSSProperties}) {
  return <span className={styles.kicker} style={style}>{children}</span>;
}

/* 1 · Opening */
function Intro({t, d, say}: SceneProps) {
  const logo = span(t, 0.15, 1.1, ease.back);
  const word = "Car Neuron.";
  return (
    <div className={styles.scene} style={{opacity: sceneOpacity(t, d)}}>
      <div className={styles.rings} style={at(960, 360)}>
        {[0, 1, 2].map(i => {
          const start = 0.7 + i * 0.6;
          const p = t < start ? 0 : ((t - start) % 1.8) / 1.8;
          return <span key={i} style={{transform: `translate(-50%, -50%) scale(${1 + p * 2.6})`, opacity: t < start ? 0 : (1 - p) * 0.45}} />;
        })}
      </div>
      <div className={styles.introLogo} style={{...at(960, 360), opacity: span(t, 0.15, 0.6), transform: `translate(-50%, -50%) scale(${lerp(0.35, 1, logo)})`}}>
        <Image src="/brand/car-neuron-logo.png" alt="" width={150} height={150} />
      </div>
      <h1 className={styles.introWord} style={at(0, 500)}>
        {[...word].map((ch, i) => {
          const p = span(t, 1.0 + i * 0.045, 1.65 + i * 0.045);
          return <span key={i} className={ch === "." ? styles.accent : undefined} style={{opacity: p, transform: `translateY(${(1 - p) * 70}px)`}}>{ch === " " ? " " : ch}</span>;
        })}
      </h1>
      <p className={styles.introTag} style={{...at(0, 680), ...rise(span(t, 2.1, 2.9))}}>{say("Hiểu chiếc xe của bạn, từ từng giây dữ liệu.", "Understand your car, one second of data at a time.")}</p>
      <span className={styles.introKicker} style={{...at(0, 770), opacity: span(t, 2.8, 3.5)}}>Vehicle Health Agent</span>
    </div>
  );
}

/* 2 · The problem: a fixed threshold */
function Gauge120({coolant, late, blink, say}: {coolant: number; late: boolean; blink: number; say: Say}) {
  const min = 50, max = 130, r = 170, cx = 210, cy = 210;
  const angle = (c: number) => lerp(-120, 120, clamp((c - min) / (max - min)));
  const point = (deg: number, radius: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const arc = (from: number, to: number, radius: number) => {
    const [x1, y1] = point(angle(from), radius);
    const [x2, y2] = point(angle(to), radius);
    return `M${x1} ${y1} A${radius} ${radius} 0 ${angle(to) - angle(from) > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const [nx, ny] = point(angle(coolant), r - 34);
  return (
    <div className={styles.gauge} style={at(1290, 150)}>
      <svg viewBox="0 0 420 330" width={420} height={330}>
        <path d={arc(min, max, r)} className={styles.gaugeTrack} />
        <path d={arc(115, max, r)} className={styles.gaugeRed} />
        <path d={arc(min, Math.max(min + 0.1, coolant), r)} className={styles.gaugeFill} data-hot={coolant >= 105 || undefined} />
        {Array.from({length: 9}, (_, i) => min + i * 10).map(c => {
          const [x1, y1] = point(angle(c), r + 16);
          const [x2, y2] = point(angle(c), r + 30);
          const [tx, ty] = point(angle(c), r + 52);
          return <g key={c}><line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.gaugeTick} /><text x={tx} y={ty + 6} textAnchor="middle" className={styles.gaugeLabel}>{c}</text></g>;
        })}
        <line x1={cx} y1={cy} x2={nx} y2={ny} className={styles.gaugeNeedle} />
        <circle cx={cx} cy={cy} r={12} className={styles.gaugeHub} />
      </svg>
      <div className={styles.gaugeValue} data-hot={coolant >= 105 || undefined}>{coolant.toFixed(0)}<small>°C</small></div>
      <div className={styles.lamp} data-on={late || undefined} style={{opacity: late ? blink : 1}}>
        <Thermometer size={34} />
      </div>
      <span className={styles.lampLabel} data-on={late || undefined}>{late ? say("Đèn báo sáng ở 120°C", "Light on at 120°C") : say("Đèn báo nhiệt · đang tắt", "Temperature light · off")}</span>
    </div>
  );
}

function Problem({t, d, say}: SceneProps) {
  const ramp = clamp((t - 1.8) / 7.2) * RULE_AT;
  const {coolant} = overheatCoolant(ramp);
  const late = coolant >= RULE;
  const ground = 860, width = 980;
  const carX = lerp(-1100, 200, span(t, 0, 1.9));
  const heat = clamp((coolant - 98) / 22);
  const engine = carPoint(carX, ground, width, 0.84, 0.42);
  const lateP = span(t, 9.0, 9.6, ease.back);
  return (
    <div className={styles.scene} style={{opacity: sceneOpacity(t, d)}}>
      <div style={{...at(120, 120), ...rise(span(t, 0.3, 1.0))}} className={styles.block}>
        <Kicker>{say("Vấn đề", "The problem")}</Kicker>
        <h2 className={styles.h2}>{say("Đèn báo chờ một con số.", "The warning light waits for one number.")}</h2>
        <p className={styles.h2Late} style={{opacity: lateP, transform: `scale(${lerp(0.9, 1, lateP)})`}}>{say("Khi nó sáng, đã quá muộn.", "When it lights up, it is too late.")}</p>
      </div>
      <Road y={ground} t={t} />
      <div className={styles.heatGlow} style={{left: px(engine.x), top: px(engine.y), opacity: heat, transform: `translate(-50%, -50%) scale(${lerp(0.4, 1.25, heat)})`}} />
      <Car x={carX} ground={ground} width={width} bob={Math.sin(t * 9) * 1.2} />
      <div className={styles.pill} style={{...at(carX + 140, ground - 400), ...rise(span(t, 2.2, 2.8))}}><Gauge size={22} />60 km/h · {say("tải 36%", "load 36%")}</div>
      <div className={`${styles.pill} ${styles.pillAlert}`} style={{...at(carX + 560, ground - 400), ...rise(span(t, 3.4, 4.0))}}><Fan size={22} />{say("Quạt làm mát 0%", "Cooling fan 0%")}</div>
      <Gauge120 coolant={coolant} late={late} blink={Math.floor(t * 4) % 2 ? 0.4 : 1} say={say} />
    </div>
  );
}

/* 3 · Signals read every second */
function Signals({t, d, say}: SceneProps) {
  const ground = 790, width = 1100, carX = 410;
  const coolant = overheatCoolant(18 + t * 1.2).coolant;
  const cards: {icon: ReactNode; label: string; value: string; ax: number; ay: number; x: number; y: number; tone?: "hot" | "alert"}[] = [
    {icon: <MapPin size={24} />, label: say("Vị trí GPS", "GPS position"), value: "10.80° N · 106.73° E", ax: 0.47, ay: 0.06, x: 110, y: 230},
    {icon: <Activity size={24} />, label: say("Vòng tua", "Engine speed"), value: `${Math.round(2200 + Math.sin(t * 1.7) * 40)} rpm`, ax: 0.64, ay: 0.38, x: 540, y: 150},
    {icon: <Thermometer size={24} />, label: say("Nước làm mát", "Coolant"), value: `${coolant.toFixed(1)}°C ↑`, ax: 0.8, ay: 0.42, x: 990, y: 130, tone: "hot"},
    {icon: <Fan size={24} />, label: say("Quạt làm mát", "Cooling fan"), value: "0%", ax: 0.97, ay: 0.6, x: 1460, y: 220, tone: "alert"},
    {icon: <Zap size={24} />, label: say("Tải động cơ", "Engine load"), value: `${(36 + Math.sin(t * 1.1) * 0.6).toFixed(1)}%`, ax: 0.88, ay: 0.55, x: 1540, y: 560},
    {icon: <Gauge size={24} />, label: say("Tốc độ", "Speed"), value: `${(60 + Math.sin(t * 1.3) * 1.2).toFixed(1)} km/h`, ax: 0.21, ay: 0.74, x: 80, y: 560},
  ];
  const dim = 1 - span(t, 7.0, 7.6) * 0.55;
  const record = `{"capturedAt":"10:42:07","coolant":${coolant.toFixed(1)},"fan":0,"engineLoad":36.2,"speed":60.4,"rpm":2213}`;
  const typed = Math.round(span(t, 7.3, 9.4, ease.linear) * record.length);
  return (
    <div className={styles.scene} style={{opacity: sceneOpacity(t, d)}}>
      <div className={styles.groundShadow} style={at(carX + width / 2, ground)} />
      <Car x={carX} ground={ground} width={width} />
      <svg className={styles.leaders} viewBox="0 0 1920 1080" style={{opacity: dim}}>
        {cards.map((card, i) => {
          const start = 0.8 + i * 0.5;
          const p = span(t, start, start + 0.4);
          const from = carPoint(carX, ground, width, card.ax, card.ay);
          const to = {x: card.x + 150, y: card.y + 56};
          return (
            <g key={i} style={{opacity: p ? 1 : 0}}>
              <line x1={from.x} y1={from.y} x2={lerp(from.x, to.x, p)} y2={lerp(from.y, to.y, p)} data-tone={card.tone} />
              <circle cx={from.x} cy={from.y} r={9} data-tone={card.tone} />
              <circle cx={from.x} cy={from.y} r={9 + ((t * 18) % 18)} className={styles.ping} data-tone={card.tone} style={{opacity: 1 - ((t * 18) % 18) / 18}} />
            </g>
          );
        })}
      </svg>
      {cards.map((card, i) => {
        const start = 0.8 + i * 0.5;
        const p = span(t, start + 0.25, start + 0.7, ease.back);
        return (
          <div key={i} className={styles.sensor} data-tone={card.tone} style={{...at(card.x, card.y), opacity: clamp(p) * dim, transform: `scale(${lerp(0.85, 1, clamp(p))})`}}>
            <span className={styles.sensorIcon}>{card.icon}</span>
            <span><small>{card.label}</small><b>{card.value}</b></span>
          </div>
        );
      })}
      <div className={styles.record} style={{...at(260, 860), ...rise(span(t, 7.1, 7.6))}}>
        <span className={styles.recordTag}><Radio size={20} />{say("1 bản ghi / giây", "1 record / second")}</span>
        <code>{record.slice(0, typed)}<i className={styles.caret} /></code>
      </div>
    </div>
  );
}

/* 4 · Batching through the gateway */
const SLOT = {x0: 470, w: 44, gap: 8, y: 505, h: 70};
const slotX = (i: number) => SLOT.x0 + i * (SLOT.w + SLOT.gap);
const A_START = 0.7, A_STEP = 0.27, FLY = 0.32;
const B_START = 6.5, B_STEP = 0.26;

function Batch({t, d, say}: SceneProps) {
  const phaseB = t >= 6.2;
  const target = phaseB ? 5 : 15;
  const flights: {i: number; born: number}[] = phaseB
    ? Array.from({length: 5}, (_, i) => ({i, born: B_START + i * B_STEP}))
    : Array.from({length: 15}, (_, i) => ({i, born: A_START + i * A_STEP}));
  const packA = span(t, 5.0, 5.9, ease.inOut);
  const packB = span(t, 7.95, 8.9, ease.inOut);
  const packing = (t >= 4.95 && t < 6.2) || t >= 7.95;
  const pack = t < 6.2 ? packA : packB;
  const packX = pack < 0.6 ? lerp(856, 1450, pack / 0.6) : lerp(1450, 1750, (pack - 0.6) / 0.4);
  const packVisible = (t >= 4.95 && t < 6.05) || (t >= 7.95 && t < 9.05);
  const arrive = (from: number) => span(t, from, from + 0.15) * (1 - span(t, from + 0.5, from + 1));
  const inject = span(t, 5.9, 6.3, ease.back);
  return (
    <div className={styles.scene} style={{opacity: sceneOpacity(t, d)}}>
      <div style={{...at(120, 120), ...rise(span(t, 0.2, 0.9))}} className={styles.block}>
        <Kicker>{say("Gom lô", "Batching")}</Kicker>
        <h2 className={styles.h2}>{phaseB ? say("Sự cố mới? Gửi sớm sau 5 mẫu.", "New scenario? Send after 5 samples.") : say("15 giây dữ liệu thành một lô.", "Fifteen seconds become one batch.")}</h2>
      </div>
      <div className={styles.device} style={at(110, 430)}>
        <span className={styles.led} style={{opacity: Math.floor(t * 2) % 2 ? 0.3 : 1}} />
        <Radio size={56} />
        <b>Blackbox</b>
        <small>OBD-II / CAN · 1 Hz</small>
      </div>
      <div className={styles.tray} style={at(SLOT.x0 - 16, SLOT.y - 16)} />
      {Array.from({length: 15}, (_, i) => {
        const flight = flights.find(f => f.i === i);
        const filled = !!flight && t >= flight.born + FLY && !packing;
        return <span key={i} className={styles.slot} data-filled={filled || undefined} data-off={i >= target || undefined} data-alert={(phaseB && filled) || undefined} style={at(slotX(i), SLOT.y)} />;
      })}
      {flights.map(({i, born}) => {
        const p = span(t, born, born + FLY, ease.inOut);
        if (t < born || t >= born + FLY) return null;
        return <span key={`${phaseB}-${i}`} className={styles.flyer} data-alert={phaseB || undefined} style={at(lerp(370, slotX(i) + 4, p), SLOT.y + 18 - Math.sin(p * Math.PI) * 70)} />;
      })}
      <p className={styles.trayLabel} style={at(SLOT.x0, SLOT.y + 100)}>
        {phaseB ? say("Lô đầu sau khi đổi kịch bản: 5 mẫu · các lô sau đủ 15", "First batch after a scenario change: 5 samples · later batches 15") : say("1 mẫu / giây · 15 mẫu / lô", "1 sample / s · 15 samples / batch")}
      </p>
      {packVisible && (
        <div className={styles.package} data-alert={t >= 7.95 || undefined} style={{...at(packX, 540), opacity: pack > 0.95 ? 0 : 1}}>
          <Layers size={22} />{t >= 7.95 ? say("Lô sớm · 5 mẫu", "Early batch · 5") : say("Lô · 15 mẫu", "Batch · 15")}
        </div>
      )}
      <div className={styles.inject} style={{...at(780, 360), opacity: inject * (1 - span(t, 8.2, 8.6)), transform: `scale(${lerp(0.7, 1, inject)})`}}>
        <MousePointerClick size={24} />{say("Mô phỏng quá nhiệt", "Inject overheating")}
        <span className={styles.ripple} style={{opacity: 1 - span(t, 6.3, 7.0), transform: `scale(${lerp(0.6, 1.8, span(t, 6.3, 7.0))})`}} />
      </div>
      <svg className={styles.pipes} viewBox="0 0 1920 1080">
        <line x1={1270} y1={540} x2={1330} y2={540} />
        <line x1={1572} y1={540} x2={1640} y2={540} />
      </svg>
      <div className={styles.node} data-pulse={arrive(5.5) + arrive(8.45) > 0.05 || undefined} style={at(1330, 455)}>
        <Layers size={34} /><b>Gateway</b><small>Next.js · /api/vehicle/telemetry</small>
      </div>
      <div className={styles.node} data-pulse={arrive(5.85) + arrive(8.85) > 0.05 || undefined} style={at(1640, 455)}>
        <Server size={34} /><b>FastAPI</b><small>{say("Backend agent", "Agent backend")}</small>
      </div>
      <span className={styles.lock} style={{...at(1640, 650), opacity: span(t, 1.2, 1.8)}}><Lock size={18} />{say("Khóa API chỉ ở Python", "API keys stay in Python")}</span>
    </div>
  );
}

/* 5 · Guardrail, tools and multi-signal reasoning */
const AGENT = {x: 960, y: 610, r: 108};
const TOOLS_Y = 150;
const TOOL_STEP = 1.85, TOOL_START = 2.9;
const GATE_X = 470, GUARD_Y = 690;

function AgentScene({t, d, say}: SceneProps) {
  const gate = span(t, 1.1, 1.6);
  const packetX = t < 1.1 ? lerp(60, GATE_X, span(t, 0.3, 1.1, ease.inOut)) : t < 1.9 ? GATE_X : lerp(GATE_X, AGENT.x - AGENT.r, span(t, 1.9, 2.6, ease.inOut));
  const packetOn = t >= 0.3 && t < 2.6;
  const tools = [
    {icon: <CloudSun size={30} />, name: say("Thời tiết", "Weather"), source: "Open-Meteo", result: say("32°C · trời nắng", "32°C · sunny"), x: 440},
    {icon: <Wrench size={30} />, name: say("Lịch sử bảo dưỡng", "Service history"), source: say("Dữ liệu seed", "Seeded records"), result: say("8 lần · không lỗi làm mát", "8 visits · no cooling faults"), x: 800},
    {icon: <MapPin size={30} />, name: say("Garage gần xe", "Nearby garages"), source: "LocationIQ", result: say("3 địa điểm · 5 km", "3 places · 5 km"), x: 1160},
  ];
  const signals = [
    say("Nhiệt +40°C/phút", "Heat +40°C/min"),
    say("Quạt 0%", "Fan 0%"),
    say("Tải phẳng ~36%", "Flat load ~36%"),
    say("Đang chạy 60 km/h", "Moving at 60 km/h"),
  ];
  const thinking = t >= 2.6;
  const verdict = span(t, 11.0, 11.6, ease.back);
  return (
    <div className={styles.scene} style={{opacity: sceneOpacity(t, d)}}>
      <svg className={styles.wires} viewBox="0 0 1920 1080">
        <line x1={60} y1={AGENT.y} x2={AGENT.x - AGENT.r} y2={AGENT.y} className={styles.wireBase} />
        <line x1={GATE_X} y1={AGENT.y + 22} x2={GATE_X} y2={GUARD_Y} className={styles.wire} data-on={t >= 1.1 || undefined} />
        {tools.map((tool, k) => {
          const s = TOOL_START + k * TOOL_STEP;
          const top = {x: tool.x + 160, y: TOOLS_Y + 150};
          const from = {x: AGENT.x + (top.x - AGENT.x) * 0.25, y: AGENT.y - AGENT.r + 6};
          const out = span(t, s, s + 0.55, ease.inOut);
          const back = span(t, s + 0.8, s + 1.3, ease.inOut);
          const dot = t < s ? null : t < s + 0.55 ? out : t < s + 0.8 ? 1 : t < s + 1.3 ? 1 - back : null;
          return (
            <g key={k}>
              <path d={`M${from.x} ${from.y} C ${from.x} ${from.y - 120}, ${top.x} ${top.y + 120}, ${top.x} ${top.y}`} className={styles.wire} data-on={t >= s || undefined} />
              {dot !== null && <circle r={10} className={styles.wireDot} cx={lerp(from.x, top.x, dot)} cy={lerp(from.y, top.y, dot) - Math.sin(dot * Math.PI) * 30} />}
            </g>
          );
        })}
        {signals.map((_, i) => {
          const y = 470 + i * 78 + 30;
          const p = span(t, 10.1 + i * 0.1, 10.7 + i * 0.1, ease.inOut);
          return <line key={i} x1={1440} y1={y} x2={lerp(1440, AGENT.x + AGENT.r - 6, p)} y2={lerp(y, AGENT.y, p)} className={styles.signalWire} style={{opacity: p ? 1 - span(t, 11.2, 11.8) : 0}} />;
        })}
      </svg>
      <div className={styles.guard} style={{...at(GATE_X - 170, GUARD_Y), ...rise(span(t, 0.4, 1.0))}} data-checked={gate > 0.5 || undefined}>
        <ShieldAlert size={30} />
        <div><b>{say("Luật an toàn cứng", "Hard safety rule")}</b><small>{say("Nước làm mát ≥ 120°C?", "Coolant ≥ 120°C?")}</small></div>
        <span className={styles.guardResult} style={{opacity: gate}}>{gate > 0.5 && <Check size={18} />}{say("104°C → chưa kích hoạt", "104°C → not triggered")}</span>
      </div>
      <span className={styles.gate} style={at(GATE_X, AGENT.y)} data-checked={gate > 0.5 || undefined} />
      {packetOn && <span className={styles.packet} style={at(packetX, AGENT.y)}><Layers size={18} /></span>}
      {tools.map((tool, k) => {
        const s = TOOL_START + k * TOOL_STEP;
        const show = span(t, 0.6 + k * 0.15, 1.2 + k * 0.15);
        const active = t >= s + 0.55;
        return (
          <div key={k} className={styles.tool} data-active={active || undefined} style={{...at(tool.x, TOOLS_Y), ...rise(show)}}>
            <span className={styles.toolIcon}>{tool.icon}</span>
            <div><b>{tool.name}</b><small>{tool.source}</small></div>
            <span className={styles.toolResult} style={{opacity: span(t, s + 0.75, s + 1.1)}}><Check size={16} />{tool.result}</span>
          </div>
        );
      })}
      <div className={styles.agent} data-alert={verdict > 0.2 || undefined} style={{...at(AGENT.x, AGENT.y), transform: `translate(-50%, -50%) scale(${1 + (thinking ? Math.sin(t * 5) * 0.015 : 0)})`}}>
        {thinking && [0, 1].map(i => {
          const p = ((t * 0.9 + i * 0.5) % 1);
          return <span key={i} className={styles.agentRing} style={{transform: `translate(-50%, -50%) scale(${1 + p * 0.7})`, opacity: (1 - p) * 0.5}} />;
        })}
        <Sparkles size={64} />
      </div>
      <div className={styles.agentLabel} style={at(AGENT.x, AGENT.y + AGENT.r + 26)}>
        <b>Car Neuron Agent</b><small>OpenAI · gpt-4.1-mini</small>
      </div>
      {signals.map((text, i) => {
        const p = span(t, 8.7 + i * 0.32, 9.2 + i * 0.32, ease.out);
        return <div key={i} className={styles.signal} data-alert={i < 2 || undefined} style={{...at(1440 + (1 - p) * 160, 470 + i * 78), opacity: p * (1 - span(t, 11.4, 11.9) * 0.6)}}><Activity size={20} />{text}</div>;
      })}
      <div className={styles.verdictChip} style={{...at(AGENT.x, 880), opacity: verdict, transform: `translate(-50%, 0) scale(${lerp(0.8, 1, verdict)})`}}>
        <TriangleAlert size={24} />{say("Xu hướng bất thường ở hệ thống làm mát", "Abnormal cooling-system trend")}
      </div>
    </div>
  );
}

/* 6 · Warning before the hard rule */
const CH = {x0: 200, x1: 1040, y0: 330, y1: 790, s: 44, c0: 92, c1: 126};
const cx = (s: number) => CH.x0 + (s / CH.s) * (CH.x1 - CH.x0);
const cy = (c: number) => CH.y1 - ((c - CH.c0) / (CH.c1 - CH.c0)) * (CH.y1 - CH.y0);

function Warning({t, d, say}: SceneProps) {
  const ramp = clamp((t - 0.5) / 9.0, 0, 1) * CH.s;
  const {coolant} = overheatCoolant(ramp);
  const points: string[] = [];
  for (let s = 0; s < ramp; s += 0.5) points.push(`${cx(s).toFixed(1)},${cy(overheatCoolant(s).coolant).toFixed(1)}`);
  points.push(`${cx(ramp).toFixed(1)},${cy(coolant).toFixed(1)}`);
  const warnAt = 0.5 + (EARLY_AT / CH.s) * 9.0;
  const ruleAt = 0.5 + (RULE_AT / CH.s) * 9.0;
  const warn = span(t, warnAt, warnAt + 0.6, ease.out);
  const rule = span(t, ruleAt, ruleAt + 0.5, ease.back);
  const gap = span(t, ruleAt + 0.6, ruleAt + 1.2);
  const evidence = [
    say("Nước làm mát tăng ~40°C/phút", "Coolant rising ~40°C/min"),
    say("Tải động cơ phẳng ~36%, xe vẫn chạy", "Flat ~36% load while moving"),
    say("Quạt làm mát 0% dù nhiệt cao", "Cooling fan at 0% despite the heat"),
  ];
  const confidence = span(t, warnAt + 1.8, warnAt + 2.8, ease.inOut) * 0.8;
  return (
    <div className={styles.scene} style={{opacity: sceneOpacity(t, d)}}>
      <div className={styles.chartCard} style={{...at(110, 150), ...rise(span(t, 0.1, 0.6))}} />
      <div className={styles.readout} style={at(170, 190)}>
        <small>{say("Nước làm mát", "Coolant")}</small>
        <b data-level={coolant >= RULE ? "late" : coolant >= 105 ? "warn" : undefined}>{coolant.toFixed(1)}°C</b>
      </div>
      <svg className={styles.chart} viewBox="0 0 1920 1080">
        {[95, 105, 115, 125].map(c => <g key={c}><line x1={CH.x0} x2={CH.x1} y1={cy(c)} y2={cy(c)} className={styles.chartGrid} /><text x={CH.x0 - 16} y={cy(c) + 8} textAnchor="end" className={styles.chartText}>{c}°</text></g>)}
        {[0, 15, 30, 45].filter(s => s <= CH.s).map(s => <text key={s} x={cx(s)} y={CH.y1 + 42} textAnchor="middle" className={styles.chartText}>{s}s</text>)}
        <rect x={cx(EARLY_AT)} y={CH.y0} width={cx(RULE_AT) - cx(EARLY_AT)} height={CH.y1 - CH.y0} className={styles.chartWindow} style={{opacity: gap * 0.8}} />
        <line x1={CH.x0} x2={CH.x1} y1={cy(RULE)} y2={cy(RULE)} className={styles.chartRule} />
        <text x={CH.x0 + 10} y={cy(RULE) - 14} className={styles.chartRuleText}>{say("Luật cứng 120°C", "Hard rule 120°C")}</text>
        <polyline points={points.join(" ")} className={styles.chartLine} />
        <circle cx={cx(ramp)} cy={cy(coolant)} r={9} className={styles.chartHead} />
        <g style={{opacity: warn}}>
          <circle cx={cx(EARLY_AT)} cy={cy(105)} r={24} className={styles.chartHalo} />
          <circle cx={cx(EARLY_AT)} cy={cy(105)} r={11} className={styles.chartEarly} />
          <text x={cx(EARLY_AT) + 26} y={cy(105) + 46} className={styles.chartEarlyText}>{say("Agent cảnh báo", "Agent warns")}</text>
        </g>
        <g style={{opacity: rule}}>
          <circle cx={cx(RULE_AT)} cy={cy(RULE)} r={11} className={styles.chartLate} />
          <text x={cx(RULE_AT) - 18} y={cy(RULE) + 50} textAnchor="end" className={styles.chartLateText}>{say("Luật cứng kích hoạt", "Hard rule fires")}</text>
        </g>
        <g style={{opacity: gap}}>
          <line x1={cx(EARLY_AT)} x2={cx(RULE_AT)} y1={cy(124.5)} y2={cy(124.5)} className={styles.chartGap} />
          <text x={(cx(EARLY_AT) + cx(RULE_AT)) / 2} y={cy(124.5) - 14} textAnchor="middle" className={styles.chartGapText}>{say(`≈ ${Math.round(RULE_AT - EARLY_AT)} giây sớm hơn`, `≈ ${Math.round(RULE_AT - EARLY_AT)} s earlier`)}</text>
        </g>
      </svg>
      <p className={styles.chartNote} style={{...at(170, 880), opacity: span(t, 0.6, 1.2)}}>{say("Kịch bản demo, thời gian rút gọn. Thời điểm thật còn phụ thuộc độ trễ của mô hình.", "Demo scenario, compressed time. The real moment also depends on model latency.")}</p>
      <div className={styles.alertCard} style={{...at(1150, 150), opacity: warn, transform: `translateX(${(1 - warn) * 80}px)`}}>
        <span className={styles.alertKicker}><TriangleAlert size={22} />{say("NÊN KIỂM TRA", "INSPECTION ADVISED")}</span>
        <h3>{say("Agent ghi nhận dấu hiệu bất thường", "The agent found warning signs")}</h3>
        <p>{say("Nhiệt độ tăng đều trong khi tải không đổi và quạt không chạy: nghi vấn ở hệ thống làm mát.", "Heat climbs steadily while the load is flat and the fan is off: the cooling system is suspect.")}</p>
        <ul>{evidence.map((item, i) => <li key={i} style={rise(span(t, warnAt + 0.6 + i * 0.35, warnAt + 1.0 + i * 0.35), 12)}><Activity size={20} />{item}</li>)}</ul>
        <div className={styles.confidence} style={{opacity: span(t, warnAt + 1.6, warnAt + 2.0)}}>
          <span>{say("Độ tin cậy tự đánh giá", "Self-reported confidence")}<b>{Math.round(confidence * 100)}%</b></span>
          <i><em style={{width: `${confidence * 100}%`}} /></i>
          <small>{say("Giá trị minh họa · chưa hiệu chuẩn", "Illustrative value · not calibrated")}</small>
        </div>
      </div>
    </div>
  );
}

/* 7 · Evidence, advice and nearby garages */
function Action({t, d, say}: SceneProps) {
  const advice = [
    say("Giảm tốc và tìm nơi dừng an toàn", "Slow down and find a safe place to stop"),
    say("Không mở nắp két nước khi máy còn nóng", "Do not open the radiator cap while hot"),
    say("Kiểm tra quạt và mức nước làm mát", "Check the fan and the coolant level"),
  ];
  const trace = [
    {icon: <ShieldAlert size={18} />, label: say("Luật an toàn cứng", "Hard safety rule")},
    {icon: <CloudSun size={18} />, label: say("Thời tiết", "Weather")},
    {icon: <Wrench size={18} />, label: say("Lịch sử bảo dưỡng", "Service history")},
    {icon: <MapPin size={18} />, label: say("Garage gần xe", "Nearby garages")},
    {icon: <Gavel size={18} />, label: say("Kết luận", "Verdict")},
  ];
  const pins = [{x: 1180, y: 420, km: "1.2"}, {x: 1560, y: 500, km: "2.4"}, {x: 1270, y: 730, km: "3.1"}];
  const radius = span(t, 3.4, 4.3, ease.inOut);
  return (
    <div className={styles.scene} style={{opacity: sceneOpacity(t, d)}}>
      <div className={styles.panel} style={{...at(150, 130), ...rise(span(t, 0.1, 0.7))}}>
        <div className={styles.panelHead}><span className={styles.avatar}><Sparkles size={28} /></span><b>Car Neuron Agent</b><em>API</em></div>
        <div className={styles.panelVerdict}><TriangleAlert size={26} />{say("Agent ghi nhận dấu hiệu bất thường", "The agent found warning signs")}</div>
        <span className={styles.panelLabel}>{say("ĐỀ XUẤT CHO BẠN", "RECOMMENDATIONS")}</span>
        <ol className={styles.advice}>{advice.map((item, i) => <li key={i} style={rise(span(t, 0.8 + i * 0.45, 1.2 + i * 0.45), 14)}><span>{i + 1}</span>{item}</li>)}</ol>
        <div className={styles.history} style={rise(span(t, 2.4, 2.9), 14)}><Wrench size={20} /><span><b>{say("Lịch sử của xe", "Vehicle history")}</b>{say("Chưa ghi nhận sự cố tương tự trong 8 lần bảo dưỡng.", "No similar issue in 8 service records.")}</span></div>
        <span className={styles.panelLabel} style={{opacity: span(t, 3.0, 3.4)}}><ListChecks size={18} />{say("AGENT ĐÃ LÀM GÌ", "WHAT THE AGENT DID")}</span>
        <div className={styles.trace}>{trace.map((step, i) => {
          const p = span(t, 3.2 + i * 0.28, 3.5 + i * 0.28);
          return <span key={i} data-warn={i === 4 || undefined} style={{opacity: p}}>{step.icon}{step.label}{p > 0.5 && <Check size={16} />}</span>;
        })}</div>
      </div>
      <div className={styles.map} style={{...at(980, 130), ...rise(span(t, 0.4, 1.0))}}>
        <div className={styles.mapHead}><MapPin size={22} /><b>{say("Garage gần xe", "Nearby garages")}</b><small>LocationIQ · OpenStreetMap</small></div>
        <svg viewBox="0 0 780 640" className={styles.mapArt}>
          <path d="M-20 470 C 160 420, 260 520, 420 470 S 700 360, 820 400" className={styles.river} />
          <path d="M0 200 L780 260" className={styles.street} /><path d="M120 0 L240 640" className={styles.street} />
          <path d="M520 0 L470 640" className={styles.street} /><path d="M0 560 L780 520" className={styles.street} />
          <path d="M0 330 C 220 300, 420 360, 780 320" className={styles.avenue} />
          <circle cx={370} cy={410} r={lerp(0, 290, radius)} className={styles.radius} />
        </svg>
        <span className={styles.mapCar} style={at(370, 410 + 90)}><Navigation /></span>
        {pins.map((pin, i) => {
          const p = span(t, 4.4 + i * 0.45, 4.9 + i * 0.45, ease.back);
          return (
            <span key={i} className={styles.pin} style={{left: px(pin.x - 980), top: px(pin.y - 130 + (1 - clamp(p)) * -60), opacity: clamp(p * 2)}}>
              <i>{i + 1}</i><b>{pin.km} km</b>
            </span>
          );
        })}
        <p className={styles.mapNote} style={{opacity: span(t, 5.6, 6.2)}}>{say("Chỉ dẫn tham khảo · không tự đặt lịch. Người lái quyết định.", "For reference only · no automatic booking. The driver decides.")}</p>
      </div>
    </div>
  );
}

function Navigation() {
  return <svg viewBox="0 0 24 24" width={30} height={30}><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="currentColor" /></svg>;
}

/* 8 · Closing */
function Outro({t, say}: SceneProps) {
  const chips = [
    {icon: <ShieldAlert size={22} />, text: say("Luật an toàn cứng", "Hard safety rule")},
    {icon: <Sparkles size={22} />, text: say("Agent OpenAI", "OpenAI agent")},
    {icon: <CloudSun size={22} />, text: "Open-Meteo"},
    {icon: <MapPin size={22} />, text: "LocationIQ"},
    {icon: <Database size={22} />, text: "SQLite"},
  ];
  return (
    <div className={styles.scene} style={{opacity: span(t, 0, 0.45)}}>
      <h2 className={styles.outroLine} style={{...at(0, 250), ...rise(span(t, 0.2, 1.0), 40)}}>{say("Mô phỏng nguồn dữ liệu.", "A simulated data source.")}</h2>
      <h2 className={`${styles.outroLine} ${styles.accent}`} style={{...at(0, 360), ...rise(span(t, 1.0, 1.8), 40)}}>{say("Mọi thứ phía sau là thật.", "Everything after it is real.")}</h2>
      <div className={styles.outroChips} style={at(0, 540)}>
        {chips.map((chip, i) => <span key={i} style={rise(span(t, 2.2 + i * 0.15, 2.7 + i * 0.15), 16)}>{chip.icon}{chip.text}</span>)}
      </div>
      <div className={styles.outroBrand} style={{...at(0, 700), ...rise(span(t, 3.4, 4.1))}}>
        <Image src="/brand/car-neuron-logo.png" alt="" width={72} height={72} />
        <b>Car Neuron<span className={styles.accent}>.</span></b>
      </div>
      <p className={styles.outroCredit} style={{...at(0, 830), opacity: span(t, 4.2, 4.8)}}>
        {say("Model 3D BMW M2: Outlaw Games™, CC BY-NC 4.0 · Không liên kết với BMW · Dữ liệu ECU mô phỏng", "BMW M2 3D model: Outlaw Games™, CC BY-NC 4.0 · Not affiliated with BMW · Simulated ECU data")}
      </p>
    </div>
  );
}

export const SCENE_COMPONENTS: Record<SceneId, ComponentType<SceneProps>> = {
  intro: Intro,
  problem: Problem,
  signals: Signals,
  batch: Batch,
  agent: AgentScene,
  warning: Warning,
  action: Action,
  outro: Outro,
};
