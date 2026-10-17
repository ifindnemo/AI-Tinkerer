import assert from "node:assert/strict";
import test from "node:test";
import {AlertTone} from "../src/lib/driver/sound";

type FakeOsc = {
  type: string;
  frequency: {value: number};
  stopped: number | null;
  onended: (() => void) | null;
  connect: (node: unknown) => FakeOsc;
  start: (when: number) => void;
  stop: (when?: number) => void;
  disconnect: () => void;
};

function fakeContext() {
  const stopped: number[] = [];
  const context = {
    currentTime: 0,
    destination: {},
    resume: () => undefined,
    close: () => undefined,
    createDynamicsCompressor: () => ({connect: () => undefined}),
    createGain: () => ({
      gain: {
        value: 0.2,
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
      },
      connect: () => ({connect: () => undefined}),
      disconnect: () => undefined,
    }),
    createOscillator: (): FakeOsc => {
      const osc: FakeOsc = {
        type: "sine",
        frequency: {value: 0},
        stopped: null,
        onended: null,
        connect: () => osc,
        start: () => undefined,
        stop: (when?: number) => { osc.stopped = when ?? context.currentTime; stopped.push(osc.stopped); },
        disconnect: () => undefined,
      };
      return osc;
    },
  };
  return {context, stopped};
}

test("stop cuts scheduled horn notes and a second stop does not throw", () => {
  const {context, stopped} = fakeContext();
  const tone = new AlertTone(() => context);
  tone.prime();
  tone.play("critical");
  assert.equal(stopped.length, 6);
  tone.stop();
  assert.equal(stopped.length, 12);
  tone.stop();
  assert.equal(stopped.length, 12);
  tone.play("warning");
  tone.stop();
  assert.ok(stopped.length > 12);
});
