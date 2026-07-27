import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("gift sharing uses durable API storage instead of blob-only links", async () => {
  const hosting = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../app/api/gifts/route.ts", import.meta.url), "utf8");
  const giftConfigSource = await readFile(new URL("../app/lib/gift-config.ts", import.meta.url), "utf8");

  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "GIFT_MEDIA");
  assert.match(pageSource, /fetch\("\/api\/gifts"/);
  assert.match(pageSource, /pendingPhotoFilesRef/);
  assert.match(pageSource, /isBlobUrl\(card\.url\) \? "" : card\.url/);
  assert.match(routeSource, /bucket\.put\(giftPhotoKey\(id, index\)/);
  assert.match(routeSource, /saveGiftPayload\(id, savedPayload\)/);
  assert.match(giftConfigSource, /parseInlineGiftValue/);
});
