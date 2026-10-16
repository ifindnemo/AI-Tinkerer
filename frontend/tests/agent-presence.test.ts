import assert from "node:assert/strict";
import test from "node:test";
import {firstSentences} from "../src/components/agent/use-agent-presence";
import {AFTER_SPEECH_MS, SHOW_MS, advance, bubbleOpen, robotState, unread, type Presence} from "../src/lib/agent/presence";

const base = (): Presence => ({agent: null, camera: null, message: null, voice: {enabled: true, blocked: false, speaking: null}, bubble: null, report: null, reportUntil: 0, reportClosed: null, happyUntil: 0, seenId: null});
const msg = (id: string, severity: "warning" | "critical" = "warning") => ({id, text: `text ${id}`, severity});

test("the robot's face follows the page in priority order", () => {
  const p = base();
  assert.equal(robotState(p, false), "idle");
  assert.equal(robotState({...p, agent: {phase: "nodata", severity: "normal"}}, false), "sleeping");
  assert.equal(robotState({...p, camera: {active: true, sound: true, severity: "normal", responded: false}, agent: {phase: "nodata", severity: "normal"}}, false), "listening");
  assert.equal(robotState({...p, camera: {active: true, sound: true, severity: "normal", responded: false}}, true), "happy");
  assert.equal(robotState({...p, agent: {phase: "analyzing", severity: "normal"}}, true), "thinking");
  assert.equal(robotState({...p, agent: {phase: "offline", severity: "normal"}}, false), "error");
  assert.equal(robotState({...p, agent: {phase: "offline", severity: "normal"}, voice: {enabled: true, blocked: false, speaking: msg("a")}}, false), "speaking");
});

test("a new alert opens the bubble for longer when it is critical", () => {
  const warned = advance(base(), {message: msg("w")}, 1000);
  assert.equal(warned.bubble?.message.id, "w");
  assert.equal(warned.bubble?.until, 1000 + SHOW_MS.warning);
  assert.ok(bubbleOpen(warned, 1000 + SHOW_MS.warning - 1));
  assert.ok(!bubbleOpen(warned, 1000 + SHOW_MS.warning));
  const critical = advance(warned, {message: msg("c", "critical")}, 2000);
  assert.equal(critical.bubble?.until, 2000 + SHOW_MS.critical);
});

test("spoken words replace the text alert, stay while playing and a little after", () => {
  const written = advance(base(), {message: msg("cam")}, 0);
  const speaking = advance(written, {voice: {enabled: true, blocked: false, speaking: msg("clip")}}, 500);
  assert.equal(speaking.bubble?.message.id, "clip");
  assert.ok(bubbleOpen(speaking, 60_000), "open while the clip plays, however long");
  const done = advance(speaking, {voice: {enabled: true, blocked: false, speaking: null}}, 60_000);
  assert.ok(bubbleOpen(done, 60_000 + AFTER_SPEECH_MS - 1));
  assert.ok(!bubbleOpen(done, 60_000 + AFTER_SPEECH_MS));
  // Re-publishing the same message (a re-render) does not reopen a bubble that timed out.
  const again = advance(done, {message: msg("cam")}, 90_000);
  assert.ok(!bubbleOpen(again, 90_000));
});

test("the robot smiles when the driver confirms or an alert clears", () => {
  const alert = {...base(), camera: {active: true, sound: true, severity: "critical" as const, responded: false}};
  assert.equal(advance(alert, {camera: {...alert.camera, responded: true}}, 100).happyUntil, 100 + 3500);
  const carAlert = {...base(), agent: {phase: "ready" as const, severity: "warning" as const}};
  assert.ok(advance(carAlert, {agent: {phase: "ready", severity: "normal"}}, 5).happyUntil > 5);
  assert.equal(advance(base(), {agent: {phase: "ready", severity: "normal"}}, 5).happyUntil, 0);
});

test("long diagnoses are cut at a sentence for the bubble", () => {
  const long = "Câu đầu tiên. " + "Câu thứ hai khá dài ".repeat(10) + ". Câu cuối.";
  const cut = firstSentences(long, 120);
  assert.ok(cut.length <= 120 && cut.startsWith("Câu đầu tiên."));
  assert.equal(firstSentences("Ngắn gọn."), "Ngắn gọn.");
});

test("an alert the viewer never saw leaves a badge until it is closed or the panel is opened", () => {
  const shown = advance(base(), {message: msg("w")}, 0);
  assert.equal(unread(shown, 1000), false, "no badge while the bubble is open");
  assert.equal(unread(shown, SHOW_MS.warning + 1), true, "badge once it timed out unseen");
  assert.equal(unread({...shown, seenId: "w"}, SHOW_MS.warning + 1), false, "seen: no badge");
  const closedByHand = {...shown, bubble: {...shown.bubble!, dismissed: true}, seenId: "w"};
  assert.equal(unread(closedByHand, 10), false);
  const normal = advance(base(), {message: {id: "n", text: "ok", severity: "normal" as const}}, 0);
  assert.equal(unread(normal, SHOW_MS.normal + 1), false, "nothing to flag for a normal note");
});
