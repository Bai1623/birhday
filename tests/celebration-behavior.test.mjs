import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("gallery entry starts hand tracking without disabling controls", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(pageSource, /const startCamera = useCallback/);
  assert.match(pageSource, /void startCamera\(\);/);
  assert.match(pageSource, /closest\("button,input,textarea,label"\)/);
});

test("countdown and fireworks are scaled up for a larger celebration", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const particleSource = await readFile(new URL("../app/lib/particle-scene.ts", import.meta.url), "utf8");
  const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(pageSource, /launchFireworks\("grand"\)/);
  assert.match(pageSource, /launchFireworks\("cake"\)/);
  assert.match(particleSource, /const maxFireworks = 4500/);
  assert.match(particleSource, /launchFireworks\(intensity: FireworkIntensity = "normal"\)/);
  assert.match(particleSource, /isNumber \? 320 :/);
  assert.match(cssSource, /translateY\(clamp\(120px, 14vw, 180px\)\)/);
});
