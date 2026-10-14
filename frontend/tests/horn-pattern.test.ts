import test from "node:test";
import assert from "node:assert/strict";
import {hornPattern} from "../src/lib/driver/sound";

test("the warning horn is two high-low pairs and the mandatory-stop horn is longer, louder and higher", () => {
  const warning = hornPattern("warning");
  const critical = hornPattern("critical");
  assert.equal(warning.length, 4);
  assert.equal(critical.length, 6);
  assert.deepEqual(warning.map(note => note.frequency), [880, 660, 880, 660], "high-low, repeated");
  for (let i = 1; i < critical.length; i++) assert.ok(critical[i].frequency < critical[i - 1].frequency === (i % 2 === 1), "critical alternates high-low as well");
  assert.ok(Math.min(...critical.map(note => note.peak)) > Math.max(...warning.map(note => note.peak)), "critical is louder than any warning note");
  assert.ok(critical.at(-1)!.at > warning.at(-1)!.at - 0.2, "critical lasts at least as long");
  for (const notes of [warning, critical]) {
    notes.forEach((note, i) => {
      assert.ok(note.peak > 0 && note.peak <= 0.6, "never above a level a compressor can hold");
      if (i > 0) assert.ok(notes[i - 1].at + notes[i - 1].length <= note.at, "notes do not overlap");
    });
    const end = notes.at(-1)!.at + notes.at(-1)!.length;
    assert.ok(end > 0.9 && end < 1.6, `an alert lasts about a second and a half at most, got ${end.toFixed(2)} s`);
  }
});
