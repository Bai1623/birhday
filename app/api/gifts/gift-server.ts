import { eq } from "drizzle-orm";
import { getDb, getWorkersEnv } from "@/db";
import { gifts } from "@/db/schema";
import { SharedGiftPayload, coerceSharedGiftPayload, sanitizeGiftId } from "@/app/lib/gift-config";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function giftPhotoKey(id: string, index: number) {
  return `gifts/${id}/photos/${index}`;
}

export function giftPhotoUrl(id: string, index: number) {
  return `/api/gifts/${encodeURIComponent(id)}/photo/${index}`;
}

export function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

export function toGiftRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${cause}`;
  if (combined.includes("no such table") || combined.includes('from "gifts"')) {
    return {
      message: "礼物存储还没初始化，请部署包含数据库迁移的最新版本后再生成链接。",
      status: 503,
    };
  }
  if (combined.includes("GIFT_MEDIA")) {
    return {
      message: "照片存储还没初始化，请部署包含 R2 绑定的最新版本后再生成链接。",
      status: 503,
    };
  }
  return { message, status: 500 };
}

export async function getGiftMediaBucket() {
  const env = await getWorkersEnv();
  if (!env.GIFT_MEDIA) {
    throw new Error("Cloudflare R2 binding `GIFT_MEDIA` is unavailable.");
  }
  return env.GIFT_MEDIA;
}

export async function loadGiftPayload(rawId: string) {
  const id = sanitizeGiftId(rawId);
  if (!id) return null;

  const db = await getDb();
  const [gift] = await db.select().from(gifts).where(eq(gifts.id, id)).limit(1);
  if (!gift) return null;

  try {
    return {
      id,
      payload: coerceSharedGiftPayload(JSON.parse(gift.payload)),
      createdAt: gift.createdAt,
    };
  } catch {
    return null;
  }
}

export async function saveGiftPayload(id: string, payload: SharedGiftPayload) {
  const db = await getDb();
  await db.insert(gifts).values({
    id,
    payload: JSON.stringify(payload),
  });
}
