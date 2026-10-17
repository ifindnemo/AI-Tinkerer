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

// The OpenAI mark (Simple Icons, CC0), drawn in the colour of the text. The agent runs on the OpenAI Agents SDK.
function OpenAIMark() {
  return (
    <svg className={styles.brandMark} viewBox="0 0 24 24" role="img" aria-label="OpenAI" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

// Technology marks (Simple Icons, CC0) for the captions of slide 3.
const TECH = {
  next: {color: "#111111", d: "M18.665 21.978C16.758 23.255 14.465 24 12 24 5.377 24 0 18.623 0 12S5.377 0 12 0s12 5.377 12 12c0 3.583-1.574 6.801-4.067 9.001L9.219 7.2H7.2v9.596h1.615V9.251l9.85 12.727Zm-3.332-8.533 1.6 2.061V7.2h-1.6v6.245Z"},
  react: {color: "#087EA4", d: "M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z"},
  fastapi: {color: "#009688", d: "M12 .0387C5.3729.0384.0003 5.3931 0 11.9988c-.001 6.6066 5.372 11.9628 12 11.9625 6.628.0003 12.001-5.3559 12-11.9625-.0003-6.6057-5.3729-11.9604-12-11.96m-.829 5.4153h7.55l-7.5805 5.3284h5.1828L5.279 18.5436q2.9466-6.5444 5.892-13.0896"},
  sqlite: {color: "#003B57", d: "M21.678.521c-1.032-.92-2.28-.55-3.513.544a8.71 8.71 0 0 0-.547.535c-2.109 2.237-4.066 6.38-4.674 9.544.237.48.422 1.093.544 1.561a13.044 13.044 0 0 1 .164.703s-.019-.071-.096-.296l-.05-.146a1.689 1.689 0 0 0-.033-.08c-.138-.32-.518-.995-.686-1.289-.143.423-.27.818-.376 1.176.484.884.778 2.4.778 2.4s-.025-.099-.147-.442c-.107-.303-.644-1.244-.772-1.464-.217.804-.304 1.346-.226 1.478.152.256.296.698.422 1.186.286 1.1.485 2.44.485 2.44l.017.224a22.41 22.41 0 0 0 .056 2.748c.095 1.146.273 2.13.5 2.657l.155-.084c-.334-1.038-.47-2.399-.41-3.967.09-2.398.642-5.29 1.661-8.304 1.723-4.55 4.113-8.201 6.3-9.945-1.993 1.8-4.692 7.63-5.5 9.788-.904 2.416-1.545 4.684-1.931 6.857.666-2.037 2.821-2.912 2.821-2.912s1.057-1.304 2.292-3.166c-.74.169-1.955.458-2.362.629-.6.251-.762.337-.762.337s1.945-1.184 3.613-1.72C21.695 7.9 24.195 2.767 21.678.521m-18.573.543A1.842 1.842 0 0 0 1.27 2.9v16.608a1.84 1.84 0 0 0 1.835 1.834h9.418a22.953 22.953 0 0 1-.052-2.707c-.006-.062-.011-.141-.016-.2a27.01 27.01 0 0 0-.473-2.378c-.121-.47-.275-.898-.369-1.057-.116-.197-.098-.31-.097-.432 0-.12.015-.245.037-.386a9.98 9.98 0 0 1 .234-1.045l.217-.028c-.017-.035-.014-.065-.031-.097l-.041-.381a32.8 32.8 0 0 1 .382-1.194l.2-.019c-.008-.016-.01-.038-.018-.053l-.043-.316c.63-3.28 2.587-7.443 4.8-9.791.066-.069.133-.128.198-.194Z"},
} as const;

function Tech({name, icon}: {name: string; icon: keyof typeof TECH}) {
  return (
    <span className={styles.tech}>
      <svg viewBox="0 0 24 24" fill={TECH[icon].color} aria-hidden="true"><path d={TECH[icon].d} /></svg>
      {name}
    </span>
  );
}

const SERVER = [
  ["Rules", "hard safety floor", null],
  ["Guardian", "car + driver policy", null],
  ["Agent", "skill + 4 tools", "openai"],
  ["Plan", "car level × driver state", null],
  ["Voice", "Blaze TTS", "blaze"],
] as const;

/** 3 · Under the hood (1:40). The film's 0:35 map, animated, over the one real excerpt: samples fill a batch, data flows, each stage lights in turn. */
function Hood() {
  return (
    <div className={`${styles.slide} ${styles.hood}`}>
      <h2 className={styles.hoodTitle}>
        <span className={styles.rise} style={delay(0)}>Sense in the browser. <em>Decide on the server.</em></span>
      </h2>
      <span className={`${styles.cap} ${styles.rise}`} style={{...delay(1), left: 120}}>Browser <i>·</i> <Tech name="Next.js 16" icon="next" /> <i>·</i> <Tech name="React 19" icon="react" /></span>
      <span className={`${styles.cap} ${styles.rise}`} style={{...delay(1), left: 840}}>Server <i>·</i> <Tech name="FastAPI" icon="fastapi" /> <i>·</i> <Tech name="SQLite" icon="sqlite" /></span>
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
        {SERVER.map(([name, note, brand], i) => (
          <div key={name} className={`${styles.card} ${styles.unit} ${styles.rise}`} style={{...delay(4 + i), ["--s" as string]: i}}>
            <b>{name}</b><span>{note}</span>
            {brand === "openai" && <OpenAIMark />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {brand === "blaze" && <img className={styles.brandMark} src="/brand/blaze-mark.png" alt="Blaze" width={160} height={154} />}
          </div>
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
