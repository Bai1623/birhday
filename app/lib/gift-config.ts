export type Card = { url?: string; title: string; subtitle: string; color: string; lon: number; lat: number };

export type SharedGiftPayload = {
  v: 1;
  name: string;
  blessing: string;
  cards: Card[];
};

export const SHARE_PARAM = "gift";
export const MAX_GIFT_CARDS = 10;

export const CARD_COPY = [
  ["遇见", "所有美好如期而至", "linear-gradient(145deg,#ff8eaa,#ffcf9e 50%,#563ca9)"],
  ["晴天", "愿笑容永远明亮", "linear-gradient(145deg,#62d8ff,#caefff 48%,#ffcd6b)"],
  ["远方", "去看更大的世界", "linear-gradient(145deg,#23438c,#9b87ff 52%,#f4a5c7)"],
  ["晚风", "把温柔轻轻收藏", "linear-gradient(145deg,#271f67,#ef83ad 52%,#ffcf9e)"],
  ["心愿", "每一岁都胜意", "linear-gradient(145deg,#f3be32,#ffef98 48%,#5e9d56)"],
  ["星光", "永远热烈又自由", "linear-gradient(145deg,#0f2769,#714fc9 50%,#4ee5d1)"],
  ["合照", "把今天记成永恒", "linear-gradient(145deg,#2c8f7c,#b9ffe9 48%,#8066ff)"],
  ["月色", "温柔会替你发光", "linear-gradient(145deg,#13213f,#6ab7ff 48%,#f7aac5)"],
  ["热烈", "愿喜欢都有回响", "linear-gradient(145deg,#e75677,#ffd166 48%,#2d6cdf)"],
  ["未来", "一路闪耀一路自由", "linear-gradient(145deg,#122c28,#7df5cf 46%,#dd8cff)"],
] as const;

export const INITIAL_CARDS: Card[] = CARD_COPY.map(([title, subtitle, color], index) => ({
  title,
  subtitle,
  color,
  lon: (index / CARD_COPY.length) * Math.PI * 2,
  lat: [-0.62, -0.24, 0.18, 0.56, -0.44, 0.02, 0.42, -0.08, 0.68, -0.5][index],
}));

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function sanitizeText(value: string, fallback: string, max: number) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

export const base64UrlEncode = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const base64UrlDecode = (encoded: string) => {
  let text = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = text.length % 4;
  if (pad) text += "=".repeat(4 - pad);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
};

export function coerceSharedGiftPayload(value: unknown): SharedGiftPayload | null {
  const parsed = value as Partial<SharedGiftPayload> | null;
  if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return null;
  const cards = Array.isArray(parsed.cards)
    ? parsed.cards.slice(0, MAX_GIFT_CARDS).map((card, index) => {
      const fallback = INITIAL_CARDS[index % INITIAL_CARDS.length];
      const rawUrl = typeof card?.url === "string" ? card.url.trim() : "";
      return {
        url: rawUrl && !rawUrl.startsWith("blob:") ? sanitizeText(rawUrl, "", 2048) : undefined,
        title: sanitizeText(typeof card?.title === "string" ? card.title : "", fallback.title, 16),
        subtitle: sanitizeText(typeof card?.subtitle === "string" ? card.subtitle : "", fallback.subtitle, 32),
        color: sanitizeText(typeof card?.color === "string" ? card.color : "", fallback.color, 90),
        lon: typeof card?.lon === "number" && Number.isFinite(card.lon) ? card.lon : fallback.lon,
        lat: typeof card?.lat === "number" && Number.isFinite(card.lat) ? card.lat : fallback.lat,
      };
    })
    : INITIAL_CARDS.map((card) => ({ ...card }));

  return {
    v: 1,
    name: sanitizeText(typeof parsed.name === "string" ? parsed.name : "", "亲爱的你", 16),
    blessing: sanitizeText(typeof parsed.blessing === "string" ? parsed.blessing : "", "愿你眼里有光，心中有爱，生日快乐，岁岁欢喜。", 120),
    cards: cards.length ? cards : INITIAL_CARDS.map((card) => ({ ...card })),
  };
}

export const normalizeCardsForExport = (cards: Card[]) =>
  cards.slice(0, MAX_GIFT_CARDS).map((card) => ({
    url: typeof card.url === "string" && !card.url.startsWith("blob:") ? sanitizeText(card.url, "", 2048) : "",
    title: sanitizeText(card.title, "回忆", 16),
    subtitle: sanitizeText(card.subtitle, "", 32),
    color: sanitizeText(card.color, "", 90),
    lon: clamp(card.lon, -Math.PI * 2, Math.PI * 2),
    lat: clamp(card.lat, -1.2, 1.2),
  }));

export function parseInlineGiftValue(value: string): SharedGiftPayload | null {
  try {
    return coerceSharedGiftPayload(JSON.parse(base64UrlDecode(value)));
  } catch {
    return null;
  }
}

export function sanitizeGiftId(value: string) {
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(trimmed) ? trimmed : "";
}
