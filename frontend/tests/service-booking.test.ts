import test from "node:test";
import assert from "node:assert/strict";
import dataset from "../src/data/engine-fault-db.json";
import { assessDatasetLabel } from "../src/lib/dataset-assessment";
import { createBooking, dateBounds, decodeBookings, validateAppointment } from "../src/lib/service-booking";
const now = new Date(2026, 8, 12, 10);
const faulty = assessDatasetLabel("1", 16002);

test("Excel class totals account for every row and preserve raw values", () => {
  assert.equal(dataset.rowCount, 55999);
  assert.equal(dataset.classes.reduce((sum, group) => sum + group.count, 0), dataset.rowCount);
  assert.deepEqual(dataset.classes.map(group => group.count), [16000, 10998, 15000, 14001]);
  assert.equal(dataset.classes[0].samples[0].values.RPM, 1192769);
});
test("user mapping reads labels without inventing fault types or health scores", () => {
  assert.equal(assessDatasetLabel("0", 2).severity, "good");
  for (const code of ["1", "2", "3"]) {
    const report = assessDatasetLabel(code, 20);
    assert.equal(report.cause, "unclassified");
    assert.equal(report.vehicleId, "enginefaultdb-sample");
    assert.equal("score" in report, false);
  }
  assert.throws(() => assessDatasetLabel("9", 2));
});
test("booking dates cross month boundaries and reject impossible dates and slots", () => {
  assert.deepEqual(dateBounds(new Date(2026, 0, 31, 10)), {min: "2026-02-01", max: "2026-02-14"});
  assert.throws(() => validateAppointment("auto-care", "2026-09-12", "09:00", now));
  assert.throws(() => validateAppointment("auto-care", "2026-09-28", "09:00", now));
  assert.throws(() => validateAppointment("auto-care", "2026-02-30", "09:00", new Date(2026, 1, 20)));
  assert.throws(() => validateAppointment("auto-care", "2026-09-13", "03:00", now));
  assert.throws(() => validateAppointment("missing", "2026-09-13", "09:00", now));
});
test("booking preserves diagnosis identity and prevents active duplicates across new reports", () => {
  const saved = createBooking(faulty, "auto-care", "2026-09-13", "09:00", [], now);
  assert.equal(saved.vehicleId, "enginefaultdb-sample");
  assert.equal(saved.reportId, faulty.id);
  assert.equal(saved.status, "saved");
  assert.throws(() => createBooking({...faulty, id: "another-report"}, "auto-care", "2026-09-14", "11:00", [saved], now), /đã có lịch/);
  assert.doesNotThrow(() => createBooking(faulty, "auto-care", "2026-09-14", "11:00", [{...saved, status: "cancelled"}], now));
  assert.throws(() => createBooking(assessDatasetLabel("0", 2), "auto-care", "2026-09-13", "09:00", [], now));
});
test("persisted records round-trip; corrupt records are not silently erased", () => {
  const saved = createBooking(faulty, "auto-care", "2026-09-13", "09:00", [], now);
  assert.deepEqual(decodeBookings(JSON.stringify([saved])), [saved]);
  assert.deepEqual(decodeBookings(null), []);
  assert.throws(() => decodeBookings("not-json"));
  assert.throws(() => decodeBookings('[{"id":"broken"}]'));
  assert.throws(() => decodeBookings(JSON.stringify([{...saved, garageId: "unknown"}])));
});
