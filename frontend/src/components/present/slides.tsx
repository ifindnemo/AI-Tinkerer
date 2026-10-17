import type {CSSProperties, ReactNode} from "react";
import {ArrowRight, Bot, Camera, Check, ExternalLink, EyeOff, Gauge, ShieldCheck, TriangleAlert, Volume2} from "lucide-react";
import styles from "./present.module.css";

export const DEMO_URL = "/garage?presenter=1&reset=1";
export const REPO_URL = "https://github.com/toannguyen-ai/AI-Tinkerer";

// Slides are drawn on a fixed 1920 × 1080 stage that the deck scales to the window.
const delay = (step: number): CSSProperties => ({["--i" as string]: step});

// The same mark as the site header, drawn in the colour of the slide.
export function Mark({size = 64, className = ""}: {size?: number; className?: string}) {
  return (
    <svg className={`${styles.mark} ${className}`} viewBox="2 15 44 23" width={size} height={size * 23 / 44} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.6 30.6H8.4M17.6 30.6H30.4M39.6 30.6H42.4C43.8 30.6 44.6 29.5 44.2 28.2L43.7 26.6C43.2 25.1 41.9 24.1 40.3 23.9L35 23.1C31.6 20.1 27.4 18.4 22.9 18.4C19.3 18.4 16.4 19.4 13.8 21.2L8.6 23.9C5.6 25 3.6 27 3.6 29C3.6 29.9 4.5 30.6 5.6 30.6Z" strokeWidth="3" />
      <circle cx="13" cy="30.6" r="4.1" strokeWidth="3" />
      <circle cx="35" cy="30.6" r="4.1" strokeWidth="3" />
      <path d="M23.6 24.4L16 28.4M23.6 24.4L32.2 28.4" strokeWidth="2.2" />
      <circle cx="23.6" cy="24.4" r="3.1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="30.6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="35" cy="30.6" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 1 · What I built (0:30). One idea: the warning light knows the car, nobody knows the driver. */
function Built() {
  return (
    <div className={`${styles.slide} ${styles.built}`}>
      <div className={styles.brandRow}><Mark size={72} /><span>Car Neuron</span></div>
      <h2 className={styles.display}>
        <span className={styles.rise} style={delay(0)}>A warning light</span>
        <span className={styles.rise} style={delay(1)}>knows the car.</span>
        <span className={`${styles.rise} ${styles.accent}`} style={delay(2)}>Not the driver.</span>
      </h2>
      <p className={`${styles.lead} ${styles.rise}`} style={delay(4)}>
        One agent that reads both, and says what to do next.
      </p>
      <div className={styles.car}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/m2-hero.webp" alt="BMW M2 coupe, an illustrative 3D render" width={1800} height={802} />
        <svg className={styles.leaders} viewBox="0 0 1000 446" aria-hidden="true">
          <path className={styles.leader} style={delay(0)} d="M285 190 L285 420" pathLength={1} />
          <path className={styles.leader} style={delay(1)} d="M640 98 L640 -34" pathLength={1} />
          <circle className={`${styles.dot} ${styles.pulse}`} cx="285" cy="190" r="11" />
          <circle className={styles.dot} cx="640" cy="98" r="11" />
        </svg>
        <span className={`${styles.pill} ${styles.pillEngine}`}><Gauge size={32} aria-hidden="true" />Blackbox<small>every second</small></span>
        <span className={`${styles.pill} ${styles.pillDriver}`}><Camera size={32} aria-hidden="true" />Camera<small>never leaves the browser</small></span>
      </div>
      <p className={styles.credit}>BMW M2: Outlaw Games™ (CC BY-NC 4.0). Not affiliated with BMW.</p>
    </div>
  );
}

/** 2 · Live demo (3:00). The slide only orients; the demo itself runs in the app. */
function Demo() {
  return (
    <div className={`${styles.slide} ${styles.demo}`}>
      <h2 className={`${styles.display} ${styles.demoTitle}`}>
        <span className={styles.rise} style={delay(0)}>Live demo</span>
      </h2>
      <p className={`${styles.lead} ${styles.rise}`} style={delay(1)}>One car. Three situations.</p>
      <ol className={styles.track}>
        <li className={styles.stop} data-tone="ok" style={delay(0)}>
          <span className={styles.node}><Check size={46} aria-hidden="true" /></span>
          <h3>Normal drive</h3>
          <p>All clear. Ask it anything.</p>
        </li>
        <li className={styles.stop} data-tone="warn" style={delay(1)}>
          <span className={styles.node}><TriangleAlert size={46} aria-hidden="true" /></span>
          <h3>Engine fault</h3>
          <p>Warning. Plan a garage.</p>
        </li>
        <li className={styles.stop} data-tone="danger" style={delay(2)}>
          <span className={styles.node}><EyeOff size={46} aria-hidden="true" /></span>
          <h3>Drowsy driver</h3>
          <p>Same fault. Stop and rest first.</p>
        </li>
      </ol>
      <div className={`${styles.demoFoot} ${styles.rise}`} style={delay(6)}>
        <span>Talk to it · Quiet it · Interrupt it</span>
        <a className={styles.cta} href={DEMO_URL} target="_blank" rel="noreferrer">Open the demo <ExternalLink size={34} aria-hidden="true" /></a>
      </div>
    </div>
  );
}

function Node({icon, name, note, step}: {icon: ReactNode; name: string; note: string; step: number}) {
  return (
    <div className={`${styles.flowNode} ${styles.rise}`} style={delay(step)}>
      <b><span className={styles.flowIcon}>{icon}</span>{name}</b>
      <small>{note}</small>
    </div>
  );
}

function Arrow({step}: {step: number}) {
  return (
    <svg className={styles.arrow} viewBox="0 0 120 24" aria-hidden="true">
      <path className={styles.arrowLine} style={delay(step)} d="M2 12 H112" pathLength={1} />
      <path className={styles.arrowHead} style={delay(step)} d="M100 3 L114 12 L100 21" />
    </svg>
  );
}

/** 3 · Under the hood (1:30). The real pipeline and one real excerpt. */
function Hood() {
  return (
    <div className={`${styles.slide} ${styles.hood}`}>
      <h2 className={styles.hoodTitle}>
        <span className={styles.rise} style={delay(0)}>Sense in the browser. Decide on the server.</span>
      </h2>
      <div className={styles.flow}>
        <div className={styles.inputs}>
          <Node icon={<Gauge size={44} />} name="Blackbox" note="1 record a second, 15 to a batch" step={1} />
          <Node icon={<Camera size={44} />} name="Camera" note="MediaPipe on the device, JSON out" step={2} />
        </div>
        <Arrow step={3} />
        <Node icon={<ShieldCheck size={44} />} name="Hard rules" note="Python and TypeScript, 13 cases" step={4} />
        <Arrow step={5} />
        <Node icon={<Bot size={44} />} name="Agent" note="Diagnosis skill and 4 tools" step={6} />
        <Arrow step={7} />
        <Node icon={<Volume2 size={44} />} name="Voice" note="A voice model, in the driver's language" step={8} />
      </div>
      <div className={styles.lower}>
        <figure className={`${styles.code} ${styles.rise}`} style={delay(9)}>
          <figcaption>agent/orchestrator.py · condensed</figcaption>
          <pre><code>
            <span className={styles.cm}>{"# the model can raise severity, never lower it\n"}</span>
            {"floor = safety.minimum_severity\n"}
            {"if SEVERITY_RANK[severity] < SEVERITY_RANK[floor]:\n"}
            <span className={styles.hl}>{"    severity = floor"}</span>
          </code></pre>
        </figure>
        <ul className={styles.facts}>
          <li className={styles.rise} style={delay(10)}><Check size={36} aria-hidden="true" />No frame leaves the tab</li>
          <li className={styles.rise} style={delay(11)}><Check size={36} aria-hidden="true" />Rules speak before the model</li>
          <li className={styles.rise} style={delay(12)}><Check size={36} aria-hidden="true" />A booking waits for the driver</li>
        </ul>
      </div>
    </div>
  );
}

const BROKE = [
  ["The agent needs 10–20 seconds", "Rules speak first. The plan follows."],
  ["The model and the rules disagreed", "The plan asks the rules, not the model."],
  ["Alerts overlapped and repeated", "Each alert is spoken once per episode."],
] as const;

/** 4 · Challenges and learnings (1:30). What broke, the fix, one trade-off, what is next. */
function Challenges() {
  return (
    <div className={`${styles.slide} ${styles.challenges}`}>
      <h2 className={styles.display}>
        <span className={styles.rise} style={delay(0)}>What broke.</span>
      </h2>
      <ol className={styles.rows}>
        {BROKE.map(([broke, fix], index) => (
          <li key={broke} className={styles.row} style={delay(index * 2 + 1)}>
            <span className={styles.was}>{broke}</span>
            <ArrowRight className={styles.go} size={56} aria-hidden="true" />
            <span className={styles.now}>{fix}</span>
          </li>
        ))}
      </ol>
      <div className={styles.pair}>
        <p className={styles.rise} style={delay(7)}><b>Trade-off</b>A browser voice is instant but differs on every device. A voice model sounds the same, a few seconds later.</p>
        <p className={styles.rise} style={delay(8)}><b>Next</b>A real car. Real faces. One LLM call after the tools.</p>
      </div>
    </div>
  );
}

/** 5 · Wrap-up (0:30). One takeaway and the repository. */
function Wrap() {
  return (
    <div className={`${styles.slide} ${styles.wrap}`}>
      <Mark size={1100} className={styles.ghost} />
      <h2 className={styles.display}>
        <span className={styles.rise} style={delay(0)}>Let rules guard.</span>
        <span className={`${styles.rise} ${styles.soft}`} style={delay(1)}>Let the model explain.</span>
      </h2>
      <div className={`${styles.wrapFoot} ${styles.rise}`} style={delay(3)}>
        <div className={styles.brandRow}><Mark size={72} /><span>Car Neuron</span></div>
        <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/toannguyen-ai/AI-Tinkerer</a>
      </div>
    </div>
  );
}

// Same order as SLIDES in deck.ts.
export const SLIDE_VIEWS = [Built, Demo, Hood, Challenges, Wrap] as const;
