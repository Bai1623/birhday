import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("MediaPipe hand tracking assets are served locally", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(pageSource, /cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision/i);
  assert.doesNotMatch(pageSource, /storage\.googleapis\.com\/mediapipe-models/i);
  assert.match(pageSource, /\/mediapipe\/wasm/);
  assert.match(pageSource, /\/mediapipe\/hand_landmarker\.task/);

  await access(new URL("../public/mediapipe/wasm/vision_wasm_internal.wasm", import.meta.url));
  await access(new URL("../public/mediapipe/wasm/vision_wasm_internal.js", import.meta.url));
  await access(new URL("../public/mediapipe/hand_landmarker.task", import.meta.url));
});
