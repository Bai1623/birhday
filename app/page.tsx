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
import { GestureGate, GESTURE_LABELS, classifyHand, createEmaLandmarkSmoother } from "./lib/gesture-core";
import { ParticleScene } from "./lib/particle-scene";

type Stage = "idle" | "countdown" | "wish" | "fireworks" | "cake" | "gallery";
type Card = { url?: string; title: string; subtitle: string; color: string; lon: number; lat: number };

const CARD_COPY = [
  ["遇见", "所有美好如期而至", "linear-gradient(145deg,#ff8eaa,#ffcf9e 50%,#563ca9)"],
  ["晴天", "愿笑容永远明亮", "linear-gradient(145deg,#62d8ff,#caefff 48%,#ffcd6b)"],
  ["远方", "去看更大的世界", "linear-gradient(145deg,#23438c,#9b87ff 52%,#f4a5c7)"],
  ["晚风", "把温柔轻轻收藏", "linear-gradient(145deg,#271f67,#ef83ad 52%,#ffcf9e)"],
  ["心愿", "每一岁都胜意", "linear-gradient(145deg,#f3be32,#ffef98 48%,#5e9d56)"],
  ["星光", "永远热烈又自由", "linear-gradient(145deg,#0f2769,#714fc9 50%,#4ee5d1)"],
];

const INITIAL_CARDS: Card[] = CARD_COPY.map(([title, subtitle, color], index) => ({
  title,
  subtitle,
  color,
  lon: (index / CARD_COPY.length) * Math.PI * 2,
  lat: [-0.58, 0.12, 0.6, -0.15, 0.42, -0.46][index],
}));

const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
const HAND_LANDMARKER_MODEL_PATH = "/mediapipe/hand_landmarker.task";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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
  const particleSceneRef = useRef<ParticleScene | null>(null);
  const pendingMorphRef = useRef<{ kind: "stars" | "text" | "cake" | "sphere"; text?: string }>({ kind: "stars" });
  const yawRef = useRef(0);
  const pitchRef = useRef(0.06);
  const yawTargetRef = useRef(0);
  const pitchTargetRef = useRef(0.06);
  const handControlUntilRef = useRef(0);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const orbitPausedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const animationRef = useRef(0);
  const inferenceRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const gestureGateRef = useRef(new GestureGate({ requiredFrames: 6, cooldownMs: 800, lostHoldMs: 650 }));
  const smoothLandmarksRef = useRef(createEmaLandmarkSmoother(0.36));
  const lastClassifiedGestureRef = useRef("none");
  const timersRef = useRef<number[]>([]);
  const cardsRef = useRef<Card[]>(INITIAL_CARDS);
  const [stage, setStage] = useState<Stage>("idle");
  const [countdown, setCountdown] = useState(5);
  const [cameraOn, setCameraOn] = useState(false);
  const [handTrackingReady, setHandTrackingReady] = useState(false);
  const [cameraHint, setCameraHint] = useState("开启手势");
  const [gestureStatus, setGestureStatus] = useState(GESTURE_LABELS.none);
  const [muted, setMuted] = useState(false);
  const [name, setName] = useState("亲爱的你");
  const [blessing, setBlessing] = useState("愿你眼里有光，心中有爱，生日快乐，岁岁欢喜。");
  const [cards, setCards] = useState<Card[]>(INITIAL_CARDS);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const selectedCardRef = useRef<number | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [orbit, setOrbit] = useState({ yaw: 0, pitch: 0.06 });

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

  const launchFireworks = useCallback(() => {
    particleSceneRef.current?.launchFireworks();
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
    }, 4600));
    timersRef.current.push(window.setTimeout(() => {
      transition("fireworks");
      morphTo("stars");
      launchFireworks();
    }, 6600));
    timersRef.current.push(window.setTimeout(() => {
      transition("cake");
      morphTo("cake");
    }, 9400));
  }, [clearSequence, launchFireworks, morphTo, muted, transition]);

  const toggleGallery = useCallback(() => {
    if (stageRef.current === "cake") {
      transition("gallery");
      morphTo("sphere");
    } else if (stageRef.current === "gallery") {
      setSelectedCard(null);
      transition("cake");
      morphTo("cake");
    }
  }, [morphTo, transition]);

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

  const toggleCamera = useCallback(async () => {
    if (streamRef.current && handTrackingReady) {
      stopCamera();
      return;
    }

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
  }, [handTrackingReady, initHandLandmarker, stopCamera]);

  const onPhotoUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 6);
    if (!files.length) return;
    const next = INITIAL_CARDS.map((card) => ({ ...card }));
    files.forEach((file, index) => {
      next[index].url = URL.createObjectURL(file);
      next[index].title = file.name.replace(/\.[^.]+$/, "").slice(0, 12) || next[index].title;
    });
    setCards(next);
  }, []);

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
    if (gesture === "open" && stageRef.current === "cake") {
      toggleGallery();
      return;
    }
    if (gesture === "fist" && stageRef.current === "gallery") {
      if (selectedCardRef.current !== null) {
        setSelectedCard(null);
      } else {
        toggleGallery();
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
  }, [getFrontCardIndex, toggleGallery]);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    selectedCardRef.current = selectedCard;
  }, [selectedCard]);

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
          yawTargetRef.current = (mirroredX - 0.5) * 3.2;
          pitchTargetRef.current = clamp((classified.center.y - 0.5) * 1.55, -0.72, 0.72);
          handControlUntilRef.current = time + 650;
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
    if (stage !== "gallery") return;
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || stage !== "gallery") return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    yawTargetRef.current += dx * 0.008;
    pitchTargetRef.current = clamp(pitchTargetRef.current + dy * 0.006, -0.72, 0.72);
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
        <button className="icon-button brand-mark" onClick={() => setCustomizing(true)} aria-label="定制祝福">
          <span className="spark-symbol">✦</span>
          <span className="brand-copy">FOR YOU</span>
        </button>
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
          <p className="lead">把声音打开，给自己留四十秒。</p>
          <button className="primary-button" onClick={begin}>
            <span>开启惊喜</span><i>→</i>
          </button>
          <button className="text-button" onClick={() => setCustomizing(true)}>先定制名字与照片</button>
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

      {customizing && (
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
              <span>回忆照片（最多 6 张）</span>
              <input type="file" accept="image/*" multiple onChange={onPhotoUpload} />
              <b>选择照片</b>
              <small>照片只在当前设备中显示，不会上传</small>
            </label>
            <button className="primary-button panel-save" onClick={() => setCustomizing(false)}>
              <span>保存祝福</span><i>✓</i>
            </button>
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
