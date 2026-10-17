import type {CSSProperties} from "react";
import {ArrowRight, Check, ExternalLink, EyeOff, TriangleAlert} from "lucide-react";
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

// The face of the intro film: brackets, an oval and two eyes that slowly close (a drowsy driver, drawn in the colour of the slide).
function Face({blink = false}: {blink?: boolean}) {
  return (
    <svg className={styles.face} viewBox="0 0 400 440" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M80 100V58h42 M278 58h42v42 M320 340v42h-42 M122 382H80v-42" />
        <ellipse cx="200" cy="218" rx="105" ry="141" opacity=".6" />
        <g className={blink ? styles.eye : undefined}><path d="M139 197Q158 178 178 197 M139 197Q158 207 178 197" /><circle cx="158" cy="197" r="6" fill="currentColor" stroke="none" /></g>
        <g className={blink ? styles.eye : undefined}><path d="M222 197Q242 178 261 197 M222 197Q242 207 261 197" /><circle cx="242" cy="197" r="6" fill="currentColor" stroke="none" /></g>
        <path d="M200 215Q195 242 188 251Q200 257 207 252 M176 288Q200 298 224 288" />
      </g>
    </svg>
  );
}

/** A reading that changes by itself: every value is stacked in one cell and each is shown for a moment, so no script has to tick. */
function Ticker({values}: {values: readonly string[]}) {
  return (
    <b className={styles.ticker}>
      {values.map((value, i) => <span key={value + i} style={{["--k" as string]: i}}>{value}</span>)}
    </b>
  );
}

const BLACKBOX = [
  ["RPM", ["2,180", "2,230", "2,205", "2,260", "2,310", "2,290", "2,340", "2,260"]],
  ["Speed", ["65 km/h", "66 km/h", "66 km/h", "67 km/h", "68 km/h", "68 km/h", "69 km/h", "67 km/h"]],
  ["Engine load", ["39 %", "41 %", "41 %", "43 %", "44 %", "46 %", "47 %", "42 %"]],
  ["Coolant", ["100 °C", "101 °C", "102 °C", "103 °C", "104 °C", "105 °C", "106 °C", "104 °C"]],
  ["Oil temperature", ["96 °C", "97 °C", "97 °C", "98 °C", "98 °C", "99 °C", "99 °C", "98 °C"]],
] as const;

/** 1 · What I built (0:40). The film's 0:20 scene: the readings keep ticking, the wires keep flowing, the eyes keep closing. */
function Built() {
  return (
    <div className={`${styles.slide} ${styles.built}`}>
      <div className={styles.brandRow}><Mark size={64} /><span>Car Neuron</span></div>
      <h2 className={styles.builtTitle}>
        <span className={styles.rise} style={delay(0)}>A warning light knows the car. <em>Not the driver.</em></span>
      </h2>
      <svg className={styles.wires} viewBox="0 0 1920 1080" aria-hidden="true">
        <path className={styles.wire} d="M660 440C770 440 805 575 860 606" />
        <path className={styles.wire} d="M660 862C780 862 805 690 862 656" />
        <path className={styles.wire} d="M1050 630H1190" />
        <path className={`${styles.flow} ${styles.flowA}`} d="M660 440C770 440 805 575 860 606" />
        <path className={`${styles.flow} ${styles.flowB}`} d="M660 862C780 862 805 690 862 656" />
        <path className={`${styles.flow} ${styles.flowC}`} d="M1050 630H1190" />
      </svg>
      <div className={`${styles.card} ${styles.blackbox} ${styles.rise}`} style={delay(1)}>
        <div className={styles.cardHead}><span className={styles.label}>Blackbox</span><span className={styles.chip}>1 record / second</span></div>
        <div className={styles.readings}>
          {BLACKBOX.map(([name, values]) => <div key={name} className={styles.reading}>{name}<Ticker values={values} /></div>)}
        </div>
        <span className={styles.note}>Illustrative demo scenario</span>
      </div>
      <div className={`${styles.card} ${styles.webcam} ${styles.rise}`} style={delay(3)}>
        <div className={styles.cardHead}><span className={styles.label}>Webcam</span><span className={styles.chip}>In the browser</span></div>
        <div className={styles.webcamBody}>
          <Face blink />
          <div className={styles.signals}><span>Eyes</span><span>Head direction</span><span>Attention</span></div>
        </div>
        <span className={styles.note}>No video leaves the tab</span>
      </div>
      <div className={`${styles.agent} ${styles.rise}`} style={delay(4)}>
        <span className={styles.agentRing}><Mark size={120} /></span>
        <span className={styles.agentLabel}>One agent</span>
      </div>
      <div className={`${styles.card} ${styles.says} ${styles.rise}`} style={delay(5)}>
        <span className={styles.label}>What the agent says</span>
        <div className={`${styles.say} ${styles.rise}`} style={delay(8)}><small>What&apos;s wrong</small><p>Coolant is climbing while the fan is off.</p></div>
        <div className={`${styles.say} ${styles.rise}`} style={delay(11)}><small>What to do next</small><p>Ease off and visit the nearest garage when convenient.</p></div>
      </div>
    </div>
  );
}

/** 2 · Live demo (2:40). The slide only orients; the demo itself runs in the app. */
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

const SERVER = [
  ["Rules", "hard safety floor"],
  ["Guardian", "car + driver policy"],
  ["Agent", "skill + 4 tools"],
  ["Plan", "car level × driver state"],
  ["Voice", "Blaze TTS"],
] as const;

/** 3 · Under the hood (1:40). The film's 0:35 map, animated, over the one real excerpt: samples fill a batch, data flows, each stage lights in turn. */
function Hood() {
  return (
    <div className={`${styles.slide} ${styles.hood}`}>
      <h2 className={styles.hoodTitle}>
        <span className={styles.rise} style={delay(0)}>Sense in the browser. <em>Decide on the server.</em></span>
      </h2>
      <span className={`${styles.cap} ${styles.rise}`} style={{...delay(1), left: 120}}>Browser · Next.js 16 · React 19</span>
      <span className={`${styles.cap} ${styles.rise}`} style={{...delay(1), left: 840}}>Server · FastAPI · SQLite</span>
      <span className={`${styles.cap} ${styles.rise}`} style={{...delay(1), left: 1440}}>Screen</span>
      <svg className={styles.wires} viewBox="0 0 1920 1080" aria-hidden="true">
        <path className={styles.wire} d="M700 297H770V420H840" />
        <path className={styles.wire} d="M700 537H770V420H840" />
        <path className={styles.wire} d="M1300 420H1440" />
        <path className={`${styles.flow} ${styles.flowA}`} d="M700 297H770V420H840" />
        <path className={`${styles.flow} ${styles.flowB}`} d="M700 537H770V420H840" />
        <path className={`${styles.flow} ${styles.flowC}`} d="M1300 420H1440" />
      </svg>
      <div className={`${styles.card} ${styles.sampler} ${styles.rise}`} style={delay(2)}>
        <div className={styles.cardHead}><span className={styles.label}>Blackbox sampler</span><span className={styles.chip}>1 record / second</span></div>
        <div className={styles.cells}>{Array.from({length: 15}, (_, i) => <i key={i} style={{["--c" as string]: i}} />)}</div>
        <div className={styles.batch}><b>×15</b><span>= 1 batch</span><span className={styles.sim}>Simulated ECU data</span></div>
      </div>
      <div className={`${styles.card} ${styles.mediapipe} ${styles.rise}`} style={delay(3)}>
        <div className={styles.cardHead}><span className={styles.label}>Camera · MediaPipe</span><span className={styles.chip}>Runs in the tab</span></div>
        <div className={styles.mediapipeBody}>
          <Face />
          <p>Face landmarks, on the device<small>No CDN. No upload.</small></p>
        </div>
      </div>
      <div className={styles.server}>
        {SERVER.map(([name, note], i) => (
          <div key={name} className={`${styles.card} ${styles.unit} ${styles.rise}`} style={{...delay(4 + i), ["--s" as string]: i}}><b>{name}</b><span>{note}</span></div>
        ))}
      </div>
      <div className={styles.screens}>
        <div className={`${styles.card} ${styles.screen} ${styles.rise}`} style={delay(9)}><span className={styles.label}>Garage dashboard</span><p>Agent card, plan and booking proposal</p></div>
        <div className={`${styles.card} ${styles.screen} ${styles.rise}`} style={delay(10)}><span className={styles.label}>Agent robot</span><p>Speaks the alert, in the driver&apos;s language</p></div>
      </div>
      <span className={`${styles.real} ${styles.rise}`} style={delay(11)}>Everything after the batch is real</span>
      <div className={styles.lower}>
        <figure className={`${styles.code} ${styles.rise}`} style={delay(12)}>
          <figcaption>agent/orchestrator.py · condensed</figcaption>
          <pre><code>
            <span className={styles.cm}>{"# the model can raise severity, never lower it\n"}</span>
            {"floor = safety.minimum_severity\n"}
            {"if SEVERITY_RANK[severity] < SEVERITY_RANK[floor]:\n"}
            <span className={styles.hl}>{"    severity = floor"}</span>
          </code></pre>
        </figure>
        <ul className={styles.facts}>
          <li className={styles.rise} style={delay(13)}><Check size={36} aria-hidden="true" />No frame leaves the tab</li>
          <li className={styles.rise} style={delay(14)}><Check size={36} aria-hidden="true" />Rules speak before the model</li>
          <li className={styles.rise} style={delay(15)}><Check size={36} aria-hidden="true" />A booking waits for the driver</li>
        </ul>
      </div>
    </div>
  );
}

const BROKE = [
  ["The agent needs 10–20 seconds", "Rules speak first. The plan follows."],
  ["The model and the rules disagreed", "The plan asks the rules, not the model."],
  ["Alerts overlapped and repeated", "A repeat stays silent for 45 seconds."],
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
