import assert from "node:assert/strict";
import test from "node:test";
import type {AgentReply} from "../src/lib/backend/contract";
import {needsConfirmation, reportFrom, reportKey} from "../src/lib/agent/report";
import {REPORT_MS, advance, questionWaiting, reportOpen, type Presence} from "../src/lib/agent/presence";

const base = (): Presence => ({agent: null, camera: null, message: null, voice: {enabled: true, blocked: false, speaking: null}, bubble: null, report: null, reportUntil: 0, reportClosed: null, happyUntil: 0, seenId: null});
const garages = {tool: "search_nearby_garages", result: {options: [
  {place_id: "b", name: "Garage Xa", latitude: 1, longitude: 1, distance_km: 3.4},
  {place_id: "a", name: "Garage Gần", address: "Garage Gần, 12 Nguyễn Huệ", latitude: 1, longitude: 1, distance_km: 0.8},
], radius_meters: 5000}};
const reply = (severity: "normal" | "warning" | "critical", extra: Partial<AgentReply> = {}, trace: AgentReply["tool_trace"] = [garages]): AgentReply => ({
  status: "normal", vehicle_id: "bmw-m2", batch_id: "b1", accepted_records: 15,
  assessment: {severity, diagnosis: "Nhiệt độ nước làm mát tăng đều. Cần kiểm tra sớm.", suspected_faults: [], evidence: [], confidence: 0.8, missing_data: [], recommendations: ["x"]},
  hard_safety_guardrail: {triggered: false, minimum_severity: "normal", reasons: []}, tool_trace: trace, memory: null, sanitization: {removed_fields: [], removed_values: 0}, ...extra,
});
const pending = (id = "act_000000000001") => ({id, incident_id: "inc_1", action_type: "book_appointment" as const, status: "pending_confirmation", payload: {garage_id: "Garage Gần", slot: "2026-10-17T09:00:00+07:00"}});
const appointment = {id: "apt_000000000001", incident_id: "inc_1", vehicle_id: "bmw-m2", garage_id: "Garage Gần", slot: "2026-10-17T09:00:00+07:00", created_at: "2026-10-16T03:00:00Z"};

test("the report lists the tools, the nearest garage by distance, and the proposal waiting for the driver", () => {
  const report = reportFrom(reply("warning", {pending_action: pending()}, [garages, {tool: "propose_booking", result: {proposed: true, garage: "Garage Gần", slot: "2026-10-17T09:00:00+07:00"}}]), "ana_1")!;
  assert.equal(report.garage?.name, "Garage Gần");
  assert.equal(report.garageCount, 2);
  assert.deepEqual(report.steps.map(step => step.kind), ["garages", "booking"], "the hard rule and the verdict are left out");
  assert.equal(needsConfirmation(report), true);
  assert.equal(report.stopFirst, false);
  assert.equal(reportKey(report), "act_000000000001");
});

test("a critical alert says to stop first and never asks for a confirmation", () => {
  const report = reportFrom(reply("critical"), "ana_2")!;
  assert.equal(report.stopFirst, true);
  assert.equal(report.pending, null);
  assert.equal(reportKey(report), "ana_2");
});

test("a normal result has no popup unless an appointment is waiting or was saved", () => {
  assert.equal(reportFrom(reply("normal"), "ana_3"), null);
  assert.ok(reportFrom(reply("normal", {appointment}), "ana_3"));
  assert.equal(reportFrom(reply("warning", {pending_action: {...pending(), status: "executed"}}), "ana_4")!.pending, null, "only a pending proposal is a question");
});

test("the popup opens for a new alert, stays for a question and stays closed once the viewer closed it", () => {
  const t0 = 1_000_000;
  const warning = reportFrom(reply("warning"), "ana_1")!;
  let p = advance(base(), {report: warning}, t0);
  assert.equal(reportOpen(p, t0 + 1000), true);
  assert.equal(reportOpen(p, t0 + REPORT_MS + 1), false, "an alert without a question closes by itself");
  // The same alert analysed again does not reopen it.
  p = advance(p, {report: reportFrom(reply("warning"), "ana_2")!}, t0 + REPORT_MS + 5000);
  assert.equal(reportOpen(p, t0 + REPORT_MS + 5001), false);
  // A proposal is a question: it stays open however long it takes.
  p = advance(p, {report: reportFrom(reply("warning", {pending_action: pending()}), "ana_3")!}, t0 + 60_000);
  assert.equal(reportOpen(p, t0 + 600_000), true);
  assert.equal(questionWaiting(p, t0 + 600_000), false);
  // Closed by hand: closed for this proposal, and the robot keeps a badge.
  p = {...p, reportClosed: reportKey(p.report!)};
  assert.equal(reportOpen(p, t0 + 600_000), false);
  assert.equal(questionWaiting(p, t0 + 600_000), true);
  p = advance(p, {report: reportFrom(reply("warning", {pending_action: pending()}), "ana_4")!}, t0 + 615_000);
  assert.equal(reportOpen(p, t0 + 615_001), false, "the same proposal does not come back every analysis");
  // Saved: it opens once more to say so.
  p = advance(p, {report: reportFrom(reply("warning", {appointment}), "ana_5")!}, t0 + 630_000);
  assert.equal(reportOpen(p, t0 + 630_001), true);
});

test("a higher level reopens a popup the viewer closed", () => {
  const t0 = 2_000_000;
  let p = advance(base(), {report: reportFrom(reply("warning"), "ana_1")!}, t0);
  p = {...p, reportClosed: reportKey(p.report!)};
  p = advance(p, {report: reportFrom(reply("critical"), "ana_2")!}, t0 + 15_000);
  assert.equal(reportOpen(p, t0 + 15_001), true);
});

test("a drowsy driver with a warning car gets the rest-first plan: stop first, no garage trip yet", () => {
  const plan = {code: "rest_then_decide" as const, driver: "drowsy" as const, title: "Nghỉ trước, rồi mới quyết định đi garage", steps: [], options: ["Nghỉ xong và tỉnh táo: lái chậm đến Garage Gần", "Vẫn mệt: nhờ người đến đón hoặc gọi cứu hộ"], spoken: "", booking: false};
  const report = reportFrom(reply("warning", {plan}), "ana_9")!;
  assert.equal(report.plan?.code, "rest_then_decide");
  assert.equal(report.stopFirst, true);
  assert.equal(reportFrom(reply("warning"), "ana_10")!.plan, null, "an older backend sends no plan");
});
