"use client";

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import {
  Card,
  INITIAL_CARDS,
  MAX_GIFT_CARDS,
  SHARE_PARAM,
  SharedGiftPayload,
  base64UrlEncode,
  clamp,
  coerceSharedGiftPayload,
  normalizeCardsForExport,
  parseInlineGiftValue,
  sanitizeGiftId,
  sanitizeText,
} from "./lib/gift-config";
import { GestureGate, GESTURE_LABELS, classifyHand, createEmaLandmarkSmoother } from "./lib/gesture-core";
import { applyHandOrbitControl } from "./lib/hand-orbit-control";
import { ParticleScene } from "./lib/particle-scene";

type Stage = "idle" | "countdown" | "wish" | "fireworks" | "cake" | "gallery";

const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
const HAND_LANDMARKER_MODEL_PATH = "/mediapipe/hand_landmarker.task";

type ShareBootstrap = {
  giftId: string;
  hasGiftParam: boolean;
  payload: SharedGiftPayload | null;
};

const getShareBootstrap = (): ShareBootstrap => {
  if (typeof window === "undefined") return { giftId: "", hasGiftParam: false, payload: null };
  const gift = new URLSearchParams(window.location.search).get(SHARE_PARAM);
  if (!gift) return { giftId: "", hasGiftParam: false, payload: null };
  const payload = parseInlineGiftValue(gift);
  return {
    giftId: payload ? "" : sanitizeGiftId(gift),
    hasGiftParam: true,
    payload,
  };
};

const isInteractiveTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest("button,input,textarea,label"));

const isBlobUrl = (value?: string) => Boolean(value?.startsWith("blob:"));

const createInlineShareUrl = (payload: SharedGiftPayload) => {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${window.location.origin}${window.location.pathname}?${SHARE_PARAM}=${encodeURIComponent(encoded)}`;
};

const copyToClipboard = async (value: string) => {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

async function compressPhotoForGift(file: File) {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" && file.size <= 5 * 1024 * 1024) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const maxEdge = 1400;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, "") || "birthday-photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}

function startBirthdayMusic() {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audio = new AudioCtx();
  const master = audio.createGain();
  master.gain.value = 0.075;
  master.connect(audio.destination);
  const notes = [
    261.63, 261.63, 293.66, 261.63, 349.23, 329.63,
    261.63, 261.63, 293.66, 261.63, 392.0, 349.23,
    261.63, 261.63, 523.25, 440.0, 349.23, 329.63, 293.66,
    466.16, 466.16, 440.0, 349.23, 392.0, 349.23,
  ];
  const durations = [
    .28, .28, .58, .58, .58, 1.1, .28, .28, .58, .58, .58, 1.1,
    .28, .28, .58, .58, .58, .58, 1.1, .28, .28, .58, .58, .58, 1.2,
  ];
  let cursor = audio.currentTime + 0.08;
  notes.forEach((frequency, i) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = i % 3 === 0 ? "sine" : "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, cursor);
    gain.gain.linearRampToValueAtTime(0.65, cursor + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, cursor + durations[i]);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(cursor);
    oscillator.stop(cursor + durations[i] + 0.1);
    cursor += durations[i];
  });
  return audio;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<Stage>("idle");
  const previousStageRef = useRef<Stage>("idle");
  const particleSceneRef = useRef<ParticleScene | null>(null);
  const pendingMorphRef = useRef<{ kind: "stars" | "text" | "cake" | "sphere"; text?: string }>({ kind: "stars" });
  const yawRef = useRef(0);
  const pitchRef = useRef(0.06);
  const yawTargetRef = useRef(0);
  const pitchTargetRef = useRef(0.06);
  const handControlUntilRef = useRef(0);
  const handMotionRef = useRef<ReturnType<typeof applyHandOrbitControl> | null>(null);
  const gestureBlockedUntilRef = useRef(0);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const orbitPausedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const animationRef = useRef(0);
  const inferenceRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraStartingRef = useRef(false);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const gestureGateRef = useRef(new GestureGate({ requiredFrames: 6, cooldownMs: 800, lostHoldMs: 650 }));
  const smoothLandmarksRef = useRef(createEmaLandmarkSmoother(0.36));
  const lastClassifiedGestureRef = useRef("none");
  const timersRef = useRef<number[]>([]);
  const cardsRef = useRef<Card[]>(INITIAL_CARDS);
  const pendingPhotoFilesRef = useRef<Array<File | null>>(Array.from({ length: MAX_GIFT_CARDS }, () => null));
  const [shareBootstrap] = useState(getShareBootstrap);
  const initialGift = shareBootstrap.payload;
  const [stage, setStage] = useState<Stage>("idle");
  const [countdown, setCountdown] = useState(5);
  const [cameraOn, setCameraOn] = useState(false);
  const [handTrackingReady, setHandTrackingReady] = useState(false);
  const [cameraHint, setCameraHint] = useState("开启手势");
  const [gestureStatus, setGestureStatus] = useState(GESTURE_LABELS.none);
  const [muted, setMuted] = useState(false);
  const [name, setName] = useState(() => initialGift?.name ?? "亲爱的你");
  const [blessing, setBlessing] = useState(() => initialGift?.blessing ?? "愿你眼里有光，心中有爱，生日快乐，岁岁欢喜。");
  const [cards, setCards] = useState<Card[]>(() => initialGift?.cards ?? INITIAL_CARDS);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const selectedCardRef = useRef<number | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [orbit, setOrbit] = useState({ yaw: 0, pitch: 0.06 });
  const isSharedView = shareBootstrap.hasGiftParam;
  const [giftLoadStatus, setGiftLoadStatus] = useState<"idle" | "loading" | "ready" | "error">(
    shareBootstrap.giftId ? "loading" : "idle",
  );
  const [giftLoadMessage, setGiftLoadMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareHint, setShareHint] = useState("");

  const transition = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const morphTo = useCallback((kind: string, text?: string) => {
    const mode = kind as "stars" | "text" | "cake" | "sphere";
    pendingMorphRef.current = { kind: mode, text };
    particleSceneRef.current?.morphTo(mode, text);
  }, []);

  const clearSequence = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const launchFireworks = useCallback((intensity?: "normal" | "grand" | "cake") => {
    particleSceneRef.current?.launchFireworks(intensity);
  }, []);

  const begin = useCallback(() => {
    clearSequence();
    setCustomizing(false);
    setSelectedCard(null);
    audioRef.current?.close().catch(() => undefined);
    audioRef.current = startBirthdayMusic();
    if (muted) audioRef.current.suspend().catch(() => undefined);
    transition("countdown");
    setCountdown(5);
    morphTo("text", "5");
    for (let value = 4; value >= 1; value--) {
      const timer = window.setTimeout(() => {
        setCountdown(value);
        morphTo("text", String(value));
      }, (5 - value) * 900);
      timersRef.current.push(timer);
    }
    timersRef.current.push(window.setTimeout(() => {
      transition("wish");
      morphTo("text", "生日快乐");
      launchFireworks("normal");
    }, 4600));
    timersRef.current.push(window.setTimeout(() => {
      transition("fireworks");
      morphTo("stars");
      launchFireworks("grand");
    }, 6600));
    timersRef.current.push(window.setTimeout(() => {
      launchFireworks("grand");
    }, 7400));
    timersRef.current.push(window.setTimeout(() => {
      launchFireworks("grand");
    }, 8200));
    timersRef.current.push(window.setTimeout(() => {
      transition("cake");
      morphTo("cake");
      launchFireworks("cake");
    }, 9400));
    timersRef.current.push(window.setTimeout(() => launchFireworks("grand"), 10200));
    timersRef.current.push(window.setTimeout(() => launchFireworks("cake"), 10900));
    timersRef.current.push(window.setTimeout(() => launchFireworks("grand"), 11800));
  }, [clearSequence, launchFireworks, morphTo, muted, transition]);

  const toggleMute = useCallback(() => {
    setMuted((value) => {
      const next = !value;
      if (audioRef.current) {
        if (next) audioRef.current.suspend().catch(() => undefined);
        else audioRef.current.resume().catch(() => undefined);
      }
      return next;
    });
  }, []);

  const stopCamera = useCallback(() => {
    cameraStartingRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    handLandmarkerRef.current?.close();
    handLandmarkerRef.current = null;
    cancelAnimationFrame(inferenceRef.current);
    setCameraOn(false);
    setHandTrackingReady(false);
    setGestureStatus(GESTURE_LABELS.none);
    setCameraHint("开启手势");
  }, []);

  const initHandLandmarker = useCallback(async () => {
    if (handLandmarkerRef.current) return handLandmarkerRef.current;
    const { FilesetResolver, HandLandmarker: MediaPipeHandLandmarker } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
    const createLandmarker = (delegate: "GPU" | "CPU") => MediaPipeHandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_LANDMARKER_MODEL_PATH,
        delegate,
      },
      runningMode: "VIDEO",
      numHands: 1,
    });
    try {
      handLandmarkerRef.current = await createLandmarker("GPU");
    } catch {
      handLandmarkerRef.current = await createLandmarker("CPU");
    }
    return handLandmarkerRef.current;
  }, []);

  const startCamera = useCallback(async () => {
    if (cameraStartingRef.current) return;
    cameraStartingRef.current = true;
    try {
      if (streamRef.current && !handTrackingReady) {
        try {
          setCameraHint("AI 初始化");
          await initHandLandmarker();
          setHandTrackingReady(true);
          setCameraHint("手势控制中");
          setGestureStatus(GESTURE_LABELS.none);
        } catch (error) {
          console.warn("HandLandmarker initialization failed", error);
          setCameraHint("AI初始化失败");
          setGestureStatus("未检测到手");
        }
        return;
      }

      try {
        setCameraHint("请允许相机");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraOn(true);
        setGestureStatus(GESTURE_LABELS.none);
        setCameraHint("AI 初始化");
        await initHandLandmarker();
        setHandTrackingReady(true);
        setCameraHint("手势控制中");
      } catch (error) {
        console.warn("Camera or HandLandmarker initialization failed", error);
        if (!streamRef.current) {
          stopCamera();
          setCameraHint("摄像头不可用");
          window.setTimeout(() => setCameraHint("开启手势"), 2400);
          return;
        }
        setHandTrackingReady(false);
        setCameraHint("AI初始化失败");
        setGestureStatus("未检测到手");
      }
    } finally {
      cameraStartingRef.current = false;
    }
  }, [handTrackingReady, initHandLandmarker, stopCamera]);

  const toggleCamera = useCallback(async () => {
    if (streamRef.current && handTrackingReady) {
      stopCamera();
      return;
    }

    await startCamera();
  }, [handTrackingReady, startCamera, stopCamera]);

  const openGallery = useCallback(() => {
    transition("gallery");
    morphTo("sphere");
    void startCamera();
  }, [morphTo, startCamera, transition]);

  const closeGallery = useCallback(() => {
    gestureBlockedUntilRef.current = performance.now() + 1200;
    handMotionRef.current = null;
    setSelectedCard(null);
    transition("cake");
    morphTo("cake");
  }, [morphTo, transition]);

  const toggleGallery = useCallback(() => {
    if (stageRef.current === "cake") openGallery();
    else if (stageRef.current === "gallery") closeGallery();
  }, [closeGallery, openGallery]);

  const onPhotoUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, MAX_GIFT_CARDS);
    if (!files.length) return;
    setShareHint("正在处理照片，稍等一下。");
    const next = cardsRef.current.map((card) => ({ ...card }));
    const preparedFiles = await Promise.all(files.map((file) => compressPhotoForGift(file)));
    preparedFiles.forEach((file, index) => {
      const previousUrl = cardsRef.current[index]?.url;
      if (previousUrl && isBlobUrl(previousUrl)) URL.revokeObjectURL(previousUrl);
      pendingPhotoFilesRef.current[index] = file;
      next[index].url = URL.createObjectURL(file);
      next[index].title = file.name.replace(/\.[^.]+$/, "").slice(0, 12) || next[index].title;
    });
    setCards(next);
    setShareHint("照片已准备好，生成链接后对方就能看到。");
  }, []);

  const onPhotoUrlChange = useCallback((index: number, value: string) => {
    if (value.trim()) pendingPhotoFilesRef.current[index] = null;
    setCards((prev) => prev.map((card, cursor) => (cursor === index ? { ...card, url: sanitizeText(value, "", 2048) } : card)));
  }, []);

  const sharePayload = useCallback(() => ({
    v: 1 as const,
    name: sanitizeText(name, "亲爱的你", 16),
    blessing: sanitizeText(blessing, "愿你眼里有光，心中有爱，生日快乐，岁岁欢喜。", 120),
    cards: normalizeCardsForExport(cards),
  }), [blessing, cards, name]);

  const generateShareLink = useCallback(async () => {
    if (typeof window === "undefined") return;
    const payload = sharePayload();
    const localFiles = pendingPhotoFilesRef.current.filter(Boolean) as File[];
    setShareHint("正在生成礼物链接。");

    try {
      const form = new FormData();
      form.set("payload", JSON.stringify(payload));
      pendingPhotoFilesRef.current.forEach((file, index) => {
        if (file) form.set(`photo${index}`, file);
      });
      const response = await fetch("/api/gifts", {
        method: "POST",
        body: form,
      });
      const result = await response.json().catch(() => null) as { shareUrl?: string; error?: string } | null;
      if (!response.ok || !result?.shareUrl) {
        throw new Error(result?.error ?? "保存礼物失败。");
      }

      setShareUrl(result.shareUrl);
      const copied = await copyToClipboard(result.shareUrl);
      setShareHint(copied ? "礼物短链接已生成并复制，可直接发给对方。" : "礼物短链接已生成，请手动复制下方链接。");
      return;
    } catch (error) {
      console.warn("Gift save failed; falling back to inline link when possible.", error);
    }

    if (localFiles.length) {
      setShareUrl("");
      setShareHint("当前环境暂时不能保存照片，所以还不能生成可分享的照片链接。部署这版后重新生成即可。");
      return;
    }

    const fallbackUrl = createInlineShareUrl(payload);
    setShareUrl(fallbackUrl);
    const copied = await copyToClipboard(fallbackUrl);
    setShareHint(copied ? "已生成兼容链接并复制；照片需要使用可公开访问的图片链接。" : "已生成兼容链接；照片需要使用可公开访问的图片链接。");
  }, [sharePayload]);

  const getFrontCardIndex = useCallback(() => {
    const cosPitch = Math.cos(pitchRef.current);
    const sinPitch = Math.sin(pitchRef.current);
    return cardsRef.current.reduce(
      (best, card, index) => {
        const a = card.lon + yawRef.current;
        const y = Math.sin(card.lat);
        const z = Math.cos(a) * Math.cos(card.lat);
        const rz = y * sinPitch + z * cosPitch;
        return rz > best.z ? { index, z: rz } : best;
      },
      { index: 0, z: -Infinity },
    ).index;
  }, []);

  const handleGestureEvent = useCallback((gesture: string) => {
    if (performance.now() < gestureBlockedUntilRef.current) return;
    if (gesture === "open" && stageRef.current === "cake") {
      openGallery();
      return;
    }
    if (gesture === "fist" && stageRef.current === "gallery") {
      if (selectedCardRef.current !== null) {
        setSelectedCard(null);
      } else {
        closeGallery();
      }
      return;
    }
    if (gesture === "pinch" && stageRef.current === "gallery") {
      if (selectedCardRef.current !== null) {
        setSelectedCard(null);
      } else {
        setSelectedCard(getFrontCardIndex());
      }
    }
  }, [closeGallery, getFrontCardIndex, openGallery]);

  useEffect(() => {
    selectedCardRef.current = selectedCard;
  }, [selectedCard]);

  useEffect(() => {
    if (!shareBootstrap.giftId) return;
    let cancelled = false;

    fetch(`/api/gifts/${encodeURIComponent(shareBootstrap.giftId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { gift?: { payload?: unknown }; error?: string } | null;
        if (!response.ok) throw new Error(result?.error ?? "礼物链接加载失败。");
        const payload = coerceSharedGiftPayload(result?.gift?.payload);
        if (!payload) throw new Error("礼物内容不完整。");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setName(payload.name);
        setBlessing(payload.blessing);
        setCards(payload.cards);
        setGiftLoadStatus("ready");
        setGiftLoadMessage("");
      })
      .catch((error) => {
        if (cancelled) return;
        setGiftLoadStatus("error");
        setGiftLoadMessage(error instanceof Error ? error.message : "礼物链接加载失败。");
      });

    return () => {
      cancelled = true;
    };
  }, [shareBootstrap.giftId]);

  useEffect(() => {
    const shouldAutoStartCamera = stage === "cake" || stage === "gallery";
    if (previousStageRef.current !== stage && shouldAutoStartCamera) {
      void startCamera();
    }
    if (stage !== "gallery") handMotionRef.current = null;
    previousStageRef.current = stage;
    stageRef.current = stage;
    cardsRef.current = cards;
  }, [cards, stage, startCamera]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const count = window.innerWidth < 700 ? 1200 : 2600;
    const scene = new ParticleScene(canvas, count);
    particleSceneRef.current = scene;
    scene.morphTo(pendingMorphRef.current.kind, pendingMorphRef.current.text);

    const resize = () => {
      scene.resize();
    };
    window.addEventListener("resize", resize);

    let last = performance.now();
    const draw = (time: number) => {
      const dt = Math.min(2, (time - last) / 16.67);
      last = time;
      const isSphere = stageRef.current === "gallery";
      if (isSphere) {
        if (!orbitPausedRef.current && time > handControlUntilRef.current) yawTargetRef.current += 0.0014 * dt;
        yawRef.current += (yawTargetRef.current - yawRef.current) * 0.055 * dt;
        pitchRef.current += (pitchTargetRef.current - pitchRef.current) * 0.05 * dt;
      }
      scene.render(time, dt, stageRef.current, yawRef.current, pitchRef.current);
      animationRef.current = requestAnimationFrame(draw);
    };
    animationRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", resize);
      scene.dispose();
      if (particleSceneRef.current === scene) particleSceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!cameraOn || !handTrackingReady) return;
    const video = videoRef.current;
    const landmarker = handLandmarkerRef.current;
    if (!video || !landmarker) return;
    let lastInference = 0;
    let lastStatus = "";
    const predict = (time: number) => {
      if (video.readyState >= 2 && time - lastInference >= 66) {
        lastInference = time;
        const results = landmarker.detectForVideo(video, time);
        const landmarks = results.landmarks?.[0];
        const smoothedLandmarks = landmarks ? smoothLandmarksRef.current(landmarks) : null;
        const classified = classifyHand(smoothedLandmarks, lastClassifiedGestureRef.current);
        lastClassifiedGestureRef.current = classified.gesture;

        if (classified.center && stageRef.current === "gallery") {
          const mirroredX = 1 - classified.center.x;
          handMotionRef.current = applyHandOrbitControl(
            handMotionRef.current,
            mirroredX,
            classified.center.y,
            time,
            (yawDelta: number, pitchDelta: number) => {
              yawTargetRef.current += yawDelta;
              pitchTargetRef.current = clamp(pitchTargetRef.current + pitchDelta, -0.86, 0.86);
            },
          );
          handControlUntilRef.current = time + 900;
        } else if (!classified.center) {
          handMotionRef.current = null;
        }

        const gated = gestureGateRef.current.update(classified.gesture, time);
        const status = GESTURE_LABELS[gated.displayGesture as keyof typeof GESTURE_LABELS] ?? GESTURE_LABELS.none;
        if (status !== lastStatus) {
          lastStatus = status;
          setGestureStatus(status);
        }
        if (gated.event) handleGestureEvent(gated.event);
      }
      inferenceRef.current = requestAnimationFrame(predict);
    };
    inferenceRef.current = requestAnimationFrame(predict);
    return () => cancelAnimationFrame(inferenceRef.current);
  }, [cameraOn, handTrackingReady, handleGestureEvent]);

  useEffect(() => () => {
    clearSequence();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    handLandmarkerRef.current?.close();
    cancelAnimationFrame(inferenceRef.current);
    audioRef.current?.close().catch(() => undefined);
    cardsRef.current.forEach((card) => card.url?.startsWith("blob:") && URL.revokeObjectURL(card.url));
  }, [clearSequence]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    if (stage !== "gallery") return;
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    if (!dragRef.current.active || stage !== "gallery") return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    yawTargetRef.current += dx * 0.01;
    pitchTargetRef.current = clamp(pitchTargetRef.current + dy * 0.007, -0.86, 0.86);
    dragRef.current.x = event.clientX;
    dragRef.current.y = event.clientY;
  };

  const cardTransforms = cards.map((card) => {
    const a = card.lon + orbit.yaw;
    const cosPitch = Math.cos(orbit.pitch);
    const sinPitch = Math.sin(orbit.pitch);
    const x = Math.sin(a) * Math.cos(card.lat);
    const y = Math.sin(card.lat);
    const z = Math.cos(a) * Math.cos(card.lat);
    const ry = y * cosPitch - z * sinPitch;
    const rz = y * sinPitch + z * cosPitch;
    const radius = typeof window === "undefined" ? 280 : Math.min(window.innerWidth, window.innerHeight) * (window.innerWidth < 700 ? .31 : .36);
    return {
      x: x * radius,
      y: ry * radius,
      z: rz,
      scale: .68 + (rz + 1) * .25,
      opacity: .32 + (rz + 1) * .34,
    };
  });

  useEffect(() => {
    if (stage !== "gallery") return;
    const refresh = window.setInterval(() => {
      setOrbit({ yaw: yawRef.current, pitch: pitchRef.current });
    }, 50);
    return () => window.clearInterval(refresh);
  }, [stage]);

  const canStartGift = giftLoadStatus !== "loading" && giftLoadStatus !== "error";

  return (
    <main
      className={`experience stage-${stage}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => { dragRef.current.active = false; }}
      onPointerCancel={() => { dragRef.current.active = false; }}
    >
      <canvas ref={canvasRef} className="particle-canvas" aria-hidden="true" />
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="vignette" />

      <header className="topbar">
        {!isSharedView && (
          <button className="icon-button brand-mark" onClick={() => setCustomizing(true)} aria-label="定制祝福">
            <span className="spark-symbol">✦</span>
            <span className="brand-copy">FOR YOU</span>
          </button>
        )}
        <div className="top-actions">
          {stage !== "idle" && (
            <button className="icon-button" onClick={toggleMute} aria-label={muted ? "打开音乐" : "关闭音乐"}>
              {muted ? "♩" : "♫"}<span className="action-label">{muted ? "音乐已关" : "音乐播放中"}</span>
            </button>
          )}
          <button className={`icon-button ${handTrackingReady ? "active" : ""}`} onClick={toggleCamera} aria-label="开启摄像头手势">
            <span className="hand-icon">✋</span><span className="action-label">{cameraHint}</span>
          </button>
        </div>
      </header>

      <div className={`camera-preview ${cameraOn ? "" : "off"} ${gestureStatus !== GESTURE_LABELS.none ? "gesture-seen" : ""}`}>
        <video ref={videoRef} muted playsInline />
        <span>{gestureStatus}</span>
      </div>

      {stage === "idle" && (
        <section className="start-screen">
          <p className="eyebrow">A LITTLE UNIVERSE MADE FOR YOU</p>
          <h1>有一份来自星河的<br /><em>生日惊喜</em></h1>
          <p className="lead">
            {giftLoadStatus === "loading"
              ? "正在装载这份专属惊喜。"
              : giftLoadStatus === "error"
                ? giftLoadMessage || "礼物链接加载失败。"
                : isSharedView
                  ? "这是为你准备的一份生日惊喜。"
                  : "把声音打开，给自己留四十秒。"}
          </p>
          <button className="primary-button" onClick={begin} disabled={!canStartGift}>
            <span>{giftLoadStatus === "loading" ? "正在准备" : "开启惊喜"}</span><i>→</i>
          </button>
          {!isSharedView && <button className="text-button" onClick={() => setCustomizing(true)}>先定制名字与照片</button>}
        </section>
      )}

      {stage === "countdown" && (
        <div className="countdown-copy" key={countdown}>
          <span>惊喜正在抵达</span>
          <strong>{countdown}</strong>
        </div>
      )}

      {stage === "wish" && (
        <div className="wish-copy">
          <span>HAPPY BIRTHDAY</span>
          <p>致 · {name}</p>
        </div>
      )}

      {stage === "fireworks" && (
        <div className="firework-copy">
          <span>愿新一岁的每一天</span>
          <strong>都有光落在你身上</strong>
        </div>
      )}

      {(stage === "cake" || stage === "gallery") && (
        <>
          <section className={`cake-heading ${stage === "gallery" ? "gallery-heading" : ""}`}>
            <p>HAPPY BIRTHDAY</p>
            <h2>生日快乐，<span>{name}</span></h2>
            <blockquote>{blessing}</blockquote>
          </section>

          <div className={`memory-cards ${stage === "gallery" ? "visible" : ""}`}>
            {cards.map((card, index) => {
              const t = cardTransforms[index];
              return (
                <button
                  key={`${card.title}-${index}`}
                  className="memory-card"
                  onPointerEnter={() => { orbitPausedRef.current = true; }}
                  onPointerLeave={() => { orbitPausedRef.current = false; }}
                  style={{
                    transform: `translate3d(calc(-50% + ${t.x}px),calc(-50% + ${t.y}px),0) scale(${t.scale})`,
                    opacity: t.opacity,
                    zIndex: Math.floor((t.z + 1) * 100),
                    pointerEvents: t.z > -0.45 ? "auto" : "none",
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (t.z < .72) {
                      yawTargetRef.current += Math.atan2(Math.sin(-card.lon - yawRef.current), Math.cos(-card.lon - yawRef.current));
                    } else setSelectedCard(index);
                  }}
                  aria-label={`查看回忆：${card.title}`}
                >
                  <div className="card-image" style={{ backgroundImage: card.url ? `url("${card.url}")` : card.color }}>
                    {!card.url && <span>{card.title}</span>}
                  </div>
                  <div className="card-caption"><strong>{card.title}</strong><small>{card.subtitle}</small></div>
                </button>
              );
            })}
          </div>

          <div className="experience-controls">
            <button className="primary-button compact" onClick={toggleGallery}>
              <span>{stage === "cake" ? "展开回忆星球" : "收拢生日蛋糕"}</span><i>{stage === "cake" ? "✦" : "⌁"}</i>
            </button>
            <p>{stage === "cake" ? "点击按钮或张开手掌" : "拖动旋转 · 点击照片 · 捏合可放大"}</p>
          </div>
        </>
      )}

      {selectedCard !== null && (
        <div className="card-modal" role="dialog" aria-modal="true" aria-label="回忆照片">
          <button className="modal-close" onClick={() => setSelectedCard(null)} aria-label="关闭">×</button>
          <div className="modal-visual" style={{ backgroundImage: cards[selectedCard].url ? `url("${cards[selectedCard].url}")` : cards[selectedCard].color }}>
            {!cards[selectedCard].url && <span>{cards[selectedCard].title}</span>}
          </div>
          <div className="modal-copy">
            <span>MEMORY · 0{selectedCard + 1}</span>
            <h3>{cards[selectedCard].title}</h3>
            <p>{cards[selectedCard].subtitle}</p>
          </div>
        </div>
      )}

      {customizing && !isSharedView && (
        <div className="customize-backdrop" onClick={() => setCustomizing(false)}>
          <section className="customize-panel" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setCustomizing(false)} aria-label="关闭">×</button>
            <p className="panel-kicker">MAKE IT YOURS</p>
            <h2>把祝福换成你的</h2>
            <label>
              <span>寿星称呼</span>
              <input value={name} maxLength={12} onChange={(event) => setName(event.target.value)} placeholder="例如：小满" />
            </label>
            <label>
              <span>祝福语</span>
              <textarea value={blessing} maxLength={60} onChange={(event) => setBlessing(event.target.value)} />
            </label>
            <label className="upload-label">
              <span>回忆照片（最多 10 张）</span>
              <input type="file" accept="image/*" multiple onChange={onPhotoUpload} />
              <b>选择照片</b>
              <small>建议填写可访问的图片链接，保证分享后能看到照片</small>
            </label>
            {cards.map((card, index) => (
              <label key={`photo-${index}`}>
                <span>照片 {index + 1} 图片链接（可选）</span>
                <input
                  value={isBlobUrl(card.url) ? "" : card.url ?? ""}
                  placeholder="https://..."
                  onChange={(event) => onPhotoUrlChange(index, event.target.value)}
                />
              </label>
            ))}
            <div className="share-tools">
              <button className="primary-button panel-share" onClick={generateShareLink}>
                <span>生成分享链接</span><i>↗</i>
              </button>
              <button className="primary-button panel-save" onClick={() => setCustomizing(false)}>
                <span>保存祝福</span><i>✓</i>
              </button>
            </div>
            {shareHint && <p className="share-hint">{shareHint}</p>}
            {shareUrl && (
              <div className="share-link-wrap">
                <span className="share-link-label">分享链接</span>
                <textarea
                  className="share-link"
                  value={shareUrl}
                  readOnly
                  rows={3}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <span className="share-link-actions">
                  <button type="button" onClick={() => { void copyToClipboard(shareUrl).then((copied) => setShareHint(copied ? "链接已复制。" : "复制失败，请手动复制。")); }}>
                    复制链接
                  </button>
                  <button type="button" onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}>
                    预览礼物
                  </button>
                </span>
              </div>
            )}
          </section>
        </div>
      )}

      <footer className="footer-note">
        <span>✦</span>
        <p>愿所有浪漫与欢喜，都在今天奔向你</p>
        <span>✦</span>
      </footer>
    </main>
  );
}
