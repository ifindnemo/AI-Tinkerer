import assert from "node:assert/strict";
import test from "node:test";
import {admitClip, alertIdentity, alertsSuppressed, audioFocus, decidePlayback, formatQuiet, isNewEscalation, type AlertSnapshot} from "../src/lib/agent/audio-focus";

const warning: AlertSnapshot = {severity: "warning", action: "reduce_load", vehicleLevel: "warning", driverSeverity: "normal"};
const drowsy: AlertSnapshot = {severity: "critical", action: "stop_nearest_safe", vehicleLevel: "warning", driverSeverity: "critical"};
const engine: AlertSnapshot = {severity: "critical", action: "stop_engine", vehicleLevel: "critical", driverSeverity: "normal"};

test("the same critical alert does not count as a new escalation", () => {
  assert.equal(isNewEscalation(engine, {...engine}), false);
  assert.equal(alertIdentity(engine), alertIdentity({...engine}));
});

test("a mandatory engine stop is a different danger from a drowsy stop", () => {
  assert.equal(isNewEscalation(drowsy, engine), true);
  assert.equal(isNewEscalation(warning, engine), true);
  assert.equal(isNewEscalation(engine, drowsy), false);
});

test("quiet drops the current alert and still allows a conversation reply", () => {
  audioFocus.reset();
  audioFocus.noteLive(warning);
  audioFocus.quiet(1_000, 60_000);
  const view = audioFocus.get();
  assert.equal(alertsSuppressed(view, 1_000 + 30_000), true);
  assert.equal(decidePlayback(view, "horn", 1_000 + 30_000, false), "drop");
  assert.equal(decidePlayback(view, "alert", 1_000 + 30_000, false), "drop");
  assert.equal(decidePlayback(view, "talk", 1_000 + 30_000, false), "play");
  assert.equal(formatQuiet(42_000), "00:42");
  audioFocus.reset();
});

test("quiet expiry does not change the saved mute, and a conversation holds alerts", () => {
  audioFocus.reset();
  audioFocus.noteLive(warning);
  audioFocus.quiet(0, 1_000);
  assert.equal(audioFocus.takeExpiry(1_500), "remind");
  audioFocus.noteLive(warning);
  audioFocus.quiet(2_000, 1_000);
  audioFocus.beginTalk();
  assert.equal(audioFocus.takeExpiry(4_000), "held");
  assert.equal(alertsSuppressed(audioFocus.get(), 4_000), true);
  audioFocus.endTalk();
  audioFocus.reset();
});

test("an old talk clip is dropped and the live turn is not", () => {
  audioFocus.reset();
  const ids = audioFocus.beginTalk();
  audioFocus.setPhase("thinking");
  const live = {id: "new", severity: "normal", group: ids.turnKey};
  const old = {id: "old", severity: "normal", group: "talk:conv_old:turn_old"};
  assert.equal(admitClip(audioFocus.get(), live, 0, false), "play");
  assert.equal(admitClip(audioFocus.get(), old, 0, false), "drop");
  assert.equal(admitClip(audioFocus.get(), {id: "alert", severity: "warning", group: "car:fast"}, 0, false), "drop");
  audioFocus.reset();
});

test("a user mute blocks alert and talk audio and is not cleared by ending quiet", () => {
  audioFocus.reset();
  audioFocus.noteLive(warning);
  audioFocus.quiet(0, 10);
  audioFocus.takeExpiry(20);
  assert.equal(decidePlayback(audioFocus.get(), "alert", 30, true), "drop");
  assert.equal(decidePlayback(audioFocus.get(), "talk", 30, true), "drop");
  assert.equal(decidePlayback(audioFocus.get(), "replay", 30, true), "drop");
  audioFocus.reset();
});

test("a new page load does not reuse the previous conversation id", () => {
  audioFocus.reset();
  const first = audioFocus.beginTalk();
  audioFocus.reset();
  const second = audioFocus.beginTalk();
  assert.notEqual(first.conversationId, second.conversationId);
  assert.notEqual(first.turnId, second.turnId);
  assert.match(first.conversationId, /^conv_[\w-]{8,}$/);
  audioFocus.reset();
});

test("a nearby turn id is not treated as the live turn", () => {
  audioFocus.reset();
  const ids = audioFocus.beginTalk();
  audioFocus.setPhase("thinking");
  const live = {id: "live", severity: "normal", group: ids.turnKey};
  const longer = {id: "longer", severity: "normal", group: `${ids.turnKey}0`};
  assert.equal(admitClip(audioFocus.get(), live, 0, false), "play");
  assert.equal(admitClip(audioFocus.get(), longer, 0, false), "drop");
  audioFocus.reset();
});

test("ending a turn keeps an active quiet window", () => {
  audioFocus.reset();
  audioFocus.noteLive(warning);
  audioFocus.quiet(1_000, 60_000);
  audioFocus.beginTalk();
  audioFocus.endTalk();
  assert.equal(audioFocus.get().quietUntil, 61_000);
  assert.equal(audioFocus.get().holdAlerts, false);
  audioFocus.reset();
});

test("a new engine stop interrupts once and the same stop does not interrupt again", () => {
  audioFocus.reset();
  audioFocus.noteLive(drowsy);
  audioFocus.quiet(0, 60_000);
  assert.equal(audioFocus.considerAlert(drowsy, 1_000), "drop");
  assert.equal(audioFocus.considerAlert(engine, 1_000), "interrupt");
  audioFocus.acceptEscalation(engine);
  assert.equal(audioFocus.considerAlert(engine, 2_000), "play");
  audioFocus.noteLive(engine);
  audioFocus.quiet(3_000, 60_000);
  assert.equal(audioFocus.considerAlert(engine, 4_000), "drop");
  audioFocus.reset();
});

test("reset never reuses conversation identity and group comparison is exact", () => {
  audioFocus.reset();
  const first = audioFocus.beginTalk();
  audioFocus.reset();
  const second = audioFocus.beginTalk();
  assert.notEqual(first.conversationId, second.conversationId);
  assert.notEqual(first.turnId, second.turnId);
  audioFocus.setPhase("thinking");
  assert.equal(admitClip(audioFocus.get(), {group: `${second.turnKey}0`, severity: "normal"}, Date.now(), false), "drop");
  audioFocus.reset();
});

test("a new conversation retires its ID without changing quiet", () => {
  audioFocus.reset();
  audioFocus.quiet(1000, 60_000);
  const old = audioFocus.beginTalk();
  audioFocus.endTalk(true);
  assert.equal(audioFocus.get().quietUntil, 61_000);
  assert.equal(audioFocus.get().conversationId, null);
  assert.notEqual(audioFocus.beginTalk().conversationId, old.conversationId);
  audioFocus.reset();
});
