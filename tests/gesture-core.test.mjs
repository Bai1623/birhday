import assert from "node:assert/strict";
import test from "node:test";

import {
  GestureGate,
  classifyHand,
  createEmaLandmarkSmoother,
  getPalmCenter,
} from "../app/lib/gesture-core.js";

const makeHand = (shape) => {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[1] = { x: 0.43, y: 0.7, z: 0 };
  points[2] = { x: 0.38, y: 0.62, z: 0 };
  points[3] = { x: 0.33, y: 0.54, z: 0 };
  points[4] = { x: 0.27, y: 0.46, z: 0 };
  points[5] = { x: 0.43, y: 0.58, z: 0 };
  points[9] = { x: 0.5, y: 0.56, z: 0 };
  points[13] = { x: 0.57, y: 0.58, z: 0 };
  points[17] = { x: 0.64, y: 0.62, z: 0 };

  if (shape === "open") {
    points[8] = { x: 0.39, y: 0.2, z: 0 };
    points[12] = { x: 0.5, y: 0.16, z: 0 };
    points[16] = { x: 0.61, y: 0.22, z: 0 };
    points[20] = { x: 0.72, y: 0.32, z: 0 };
  }

  if (shape === "fist") {
    points[4] = { x: 0.46, y: 0.61, z: 0 };
    points[8] = { x: 0.44, y: 0.66, z: 0 };
    points[12] = { x: 0.5, y: 0.66, z: 0 };
    points[16] = { x: 0.56, y: 0.66, z: 0 };
    points[20] = { x: 0.62, y: 0.67, z: 0 };
  }

  if (shape === "pinch") {
    points[8] = { x: 0.285, y: 0.47, z: 0 };
    points[12] = { x: 0.5, y: 0.18, z: 0 };
    points[16] = { x: 0.6, y: 0.22, z: 0 };
    points[20] = { x: 0.7, y: 0.31, z: 0 };
  }

  if (shape === "curledPinch") {
    points[4] = { x: 0.455, y: 0.62, z: 0 };
    points[8] = { x: 0.465, y: 0.63, z: 0 };
    points[12] = { x: 0.5, y: 0.66, z: 0 };
    points[16] = { x: 0.56, y: 0.66, z: 0 };
    points[20] = { x: 0.62, y: 0.67, z: 0 };
  }

  if (shape === "point") {
    points[8] = { x: 0.42, y: 0.22, z: 0 };
    points[12] = { x: 0.5, y: 0.66, z: 0 };
    points[16] = { x: 0.56, y: 0.66, z: 0 };
    points[20] = { x: 0.62, y: 0.67, z: 0 };
  }

  return points;
};

test("classifies 21-landmark open palm, fist, and pinch", () => {
  assert.equal(classifyHand(makeHand("open"), "none").gesture, "open");
  assert.equal(classifyHand(makeHand("fist"), "none").gesture, "fist");
  assert.equal(classifyHand(makeHand("pinch"), "none").gesture, "pinch");
});

test("classifies curled pinch before fist to avoid accidental close", () => {
  assert.equal(classifyHand(makeHand("curledPinch"), "none").gesture, "pinch");
});

test("classifies index finger point as a photo selection gesture", () => {
  assert.equal(classifyHand(makeHand("point"), "none").gesture, "point");
});

test("calculates palm center from wrist and MCP landmarks", () => {
  assert.deepEqual(getPalmCenter(makeHand("open")), {
    x: 0.528,
    y: 0.632,
  });
});

test("smooths landmarks with EMA", () => {
  const smooth = createEmaLandmarkSmoother(0.25);
  smooth(makeHand("open"));
  const moved = makeHand("open").map((point) => ({ ...point, x: point.x + 0.4 }));
  const result = smooth(moved);
  assert.equal(Number(result[0].x.toFixed(3)), 0.6);
});

test("requires six stable frames and enforces an 800ms cooldown", () => {
  const gate = new GestureGate({ requiredFrames: 6, cooldownMs: 800 });
  const events = [];
  for (let i = 0; i < 5; i++) events.push(gate.update("open", i * 16).event);
  assert.deepEqual(events, [null, null, null, null, null]);
  assert.equal(gate.update("open", 80).event, "open");
  assert.equal(gate.update("fist", 96).event, null);
  for (let i = 0; i < 6; i++) gate.update("fist", 112 + i * 16);
  assert.equal(gate.update("fist", 500).event, null);
  assert.equal(gate.update("fist", 900).event, "fist");
});

test("allows the same gesture again after release and cooldown", () => {
  const gate = new GestureGate({ requiredFrames: 6, cooldownMs: 800, lostHoldMs: 0 });
  for (let i = 0; i < 5; i++) gate.update("pinch", i * 16);
  assert.equal(gate.update("pinch", 80).event, "pinch");
  for (let i = 0; i < 6; i++) gate.update("none", 100 + i * 16);
  for (let i = 0; i < 5; i++) gate.update("pinch", 900 + i * 16);
  assert.equal(gate.update("pinch", 980).event, "pinch");
});
