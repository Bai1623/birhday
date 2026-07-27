import {
  SharedGiftPayload,
  coerceSharedGiftPayload,
} from "@/app/lib/gift-config";
import {
  MAX_IMAGE_BYTES,
  SUPPORTED_IMAGE_TYPES,
  getGiftMediaBucket,
  giftPhotoKey,
  giftPhotoUrl,
  jsonError,
  saveGiftPayload,
  toGiftRouteError,
} from "./gift-server";

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError("请求格式不正确。", 400);
    }

    const rawPayload = form.get("payload");
    if (typeof rawPayload !== "string") {
      return jsonError("缺少礼物内容。", 400);
    }

    let payload: SharedGiftPayload | null = null;
    try {
      payload = coerceSharedGiftPayload(JSON.parse(rawPayload));
    } catch {
      return jsonError("礼物内容无法解析。", 400);
    }
    if (!payload) return jsonError("礼物内容不完整。", 400);

    const id = crypto.randomUUID().replace(/-/g, "");
    const cards = payload.cards.map((card) => ({ ...card }));
    const bucket = await getGiftMediaBucket();

    for (let index = 0; index < cards.length; index += 1) {
      const value = form.get(`photo${index}`);
      if (!(value instanceof File) || value.size === 0) continue;
      if (!SUPPORTED_IMAGE_TYPES.has(value.type)) {
        return jsonError(`照片 ${index + 1} 不是支持的图片格式。`, 400);
      }
      if (value.size > MAX_IMAGE_BYTES) {
        return jsonError(`照片 ${index + 1} 太大，请压缩到 5MB 以内。`, 400);
      }

      await bucket.put(giftPhotoKey(id, index), value.stream(), {
        httpMetadata: {
          contentType: value.type,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
      cards[index].url = giftPhotoUrl(id, index);
    }

    const savedPayload: SharedGiftPayload = { ...payload, cards };
    await saveGiftPayload(id, savedPayload);

    const url = new URL(request.url);
    url.search = "";
    url.pathname = "/";
    url.searchParams.set("gift", id);

    return Response.json({
      gift: { id, payload: savedPayload },
      shareUrl: url.toString(),
    }, { status: 201 });
  } catch (error) {
    const routeError = toGiftRouteError(error);
    return jsonError(routeError.message, routeError.status);
  }
}
