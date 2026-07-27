import { jsonError, loadGiftPayload, toGiftRouteError } from "../gift-server";

type GiftRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: GiftRouteContext) {
  try {
    const { id } = await context.params;
    const gift = await loadGiftPayload(id);
    if (!gift?.payload) return jsonError("礼物链接不存在或已失效。", 404);

    return Response.json({
      gift: {
        id: gift.id,
        payload: gift.payload,
        createdAt: gift.createdAt,
      },
    });
  } catch (error) {
    const routeError = toGiftRouteError(error);
    return jsonError(routeError.message, routeError.status);
  }
}
