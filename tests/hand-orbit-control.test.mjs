import assert from "node:assert/strict";
import test from "node:test";

import {
  HAND_YAW_DELTA_GAIN,
  applyHandOrbitControl,
} from "../app/lib/hand-orbit-control.js";

const stepMotion = (state, x, time, deltas) =>
  applyHandOrbitControl(state, x, 0.5, time, (yawDelta, pitchDelta) => {
    deltas.yaw += yawDelta;
    deltas.pitch += pitchDelta;
  });

test("hand orbit control accumulates repeated same-direction swipes", () => {
  const deltas = { yaw: 0, pitch: 0 };
  let motion = null;

  motion = stepMotion(motion, 0.5, 0, deltas);
  motion = stepMotion(motion, 0.56, 80, deltas);
  motion = stepMotion(motion, 0.63, 180, deltas);
  const afterFirstSwipe = deltas.yaw;

  assert.ok(afterFirstSwipe > 1.6);

  motion = stepMotion(motion, 0.55, 260, deltas);
  motion = stepMotion(motion, 0.52, 340, deltas);
  const afterReturn = deltas.yaw;

  assert.ok(afterReturn >= afterFirstSwipe - 0.05);

  motion = stepMotion(motion, 0.58, 440, deltas);
  stepMotion(motion, 0.66, 640, deltas);

  assert.ok(deltas.yaw > afterReturn + 1.6);
});

test("hand orbit control still allows deliberate reverse swipes after reset", () => {
  const deltas = { yaw: 0, pitch: 0 };
  let motion = null;

  motion = stepMotion(motion, 0.5, 0, deltas);
  motion = stepMotion(motion, 0.64, 160, deltas);
  motion = stepMotion(motion, 0.52, 260, deltas);
  const afterReset = deltas.yaw;

  motion = stepMotion(motion, 0.46, 420, deltas);
  stepMotion(motion, 0.38, 620, deltas);

  assert.ok(deltas.yaw < afterReset - 1.4);
});

test("hand orbit control applies continuous movement with tuned yaw gain", () => {
  const deltas = { yaw: 0, pitch: 0 };
  let motion = null;

  motion = stepMotion(motion, 0.5, 0, deltas);
  stepMotion(motion, 0.54, 80, deltas);

  assert.equal(Number(deltas.yaw.toFixed(2)), Number((0.04 * HAND_YAW_DELTA_GAIN).toFixed(2)));
});
