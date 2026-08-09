import {
  MAX_GIFT_CARDS,
} from "@/app/lib/gift-config";
import {
  getGiftMediaBucket,
  giftPhotoKey,
  jsonError,
  loadGiftPayload,
  toGiftRouteError,
} from "../../../gift-server";

type GiftPhotoRouteContext = {
  params: Promise<{ id: string; index: string }>;
};

export async function GET(_request: Request, context: GiftPhotoRouteContext) {
  try {
    const { id, index: rawIndex } = await context.params;
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_GIFT_CARDS) {
      return jsonError("照片编号不正确。", 400);
    }

    const gift = await loadGiftPayload(id);
    if (!gift?.payload) return jsonError("礼物链接不存在或已失效。", 404);
    const card = gift.payload.cards[index];
    if (!card?.url?.includes(`/api/gifts/${id}/photo/${index}`)) {
      return jsonError("这张照片不存在。", 404);
    }

    const object = await (await getGiftMediaBucket()).get(giftPhotoKey(id, index));
    if (!object?.body) return jsonError("这张照片不存在。", 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", object.httpEtag);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "image/jpeg");

    return new Response(object.body, { headers });
  } catch (error) {
    const routeError = toGiftRouteError(error);
    return jsonError(routeError.message, routeError.status);
  }
}
