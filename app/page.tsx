"use client";

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type Stage = "idle" | "countdown" | "wish" | "fireworks" | "cake" | "gallery";
type Point = { x: number; y: number; tx: number; ty: number; z: number; size: number; hue: number };
type Firework = { x: number; y: number; vx: number; vy: number; life: number; hue: number };
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function makeTextTargets(text: string, width: number, height: number, count: number) {
  const surface = document.createElement("canvas");
  surface.width = Math.min(900, Math.max(360, Math.floor(width * 0.78)));
  surface.height = 280;
  const ctx = surface.getContext("2d")!;
  ctx.clearRect(0, 0, surface.width, surface.height);
  const isNumber = text.length === 1;
  ctx.font = `800 ${isNumber ? 220 : clamp(surface.width / 5, 92, 150)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(text, surface.width / 2, surface.height / 2);
  const data = ctx.getImageData(0, 0, surface.width, surface.height).data;
  const candidates: { x: number; y: number }[] = [];
  const step = isNumber ? 3 : 4;
  for (let y = 0; y < surface.height; y += step) {
    for (let x = 0; x < surface.width; x += step) {
      if (data[(y * surface.width + x) * 4 + 3] > 100) candidates.push({ x, y });
    }
  }
  const result = [];
  const cx = width / 2;
  const cy = height / 2;
  for (let i = 0; i < count; i++) {
    const p = candidates[(Math.random() * candidates.length) | 0] ?? { x: surface.width / 2, y: 140 };
    result.push({ x: cx + p.x - surface.width / 2, y: cy + p.y - surface.height / 2 });
  }
  return result;
}

function makeCakeTargets(width: number, height: number, count: number) {
  const cx = width / 2;
  const cy = height / 2 + Math.min(55, height * 0.07);
  const scale = Math.min(width / 780, height / 720, 1.18);
  const points: { x: number; y: number }[] = [];
  const tiers = [
    { y: 91, w: 245, h: 76 },
    { y: 9, w: 190, h: 70 },
    { y: -66, w: 135, h: 62 },
  ];
  for (let i = 0; i < count - 180; i++) {
    const choice = Math.random();
    const tier = choice < .42 ? tiers[0] : choice < .75 ? tiers[1] : tiers[2];
    const onTop = Math.random() < .24;
    let x: number;
    let y: number;
    if (onTop) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random());
      x = Math.cos(angle) * tier.w * radius;
      y = tier.y - tier.h / 2 + Math.sin(angle) * 18 * radius;
    } else {
      x = (Math.random() * 2 - 1) * tier.w;
      y = tier.y + (Math.random() - .5) * tier.h;
    }
    points.push({ x: cx + x * scale, y: cy + y * scale });
  }
  for (let i = 0; i < 100; i++) {
    points.push({
      x: cx + (Math.random() - 0.5) * 18 * scale,
      y: cy + (-160 + Math.random() * 66) * scale,
    });
  }
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (7 + Math.random() * 13) * scale;
    const spike = Math.random() > 0.45 ? 1.8 : 1;
    points.push({
      x: cx + Math.cos(a) * r * spike,
      y: cy + (-170 + Math.sin(a) * r * spike) * scale,
    });
  }
  return points;
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
  const pointsRef = useRef<Point[]>([]);
  const fireworksRef = useRef<Firework[]>([]);
  const targetKindRef = useRef("stars");
  const yawRef = useRef(0);
  const pitchRef = useRef(0.06);
  const yawTargetRef = useRef(0);
  const pitchTargetRef = useRef(0.06);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const orbitPausedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const animationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const timersRef = useRef<number[]>([]);
  const cardsRef = useRef<Card[]>(INITIAL_CARDS);
  const [stage, setStage] = useState<Stage>("idle");
  const [countdown, setCountdown] = useState(5);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraHint, setCameraHint] = useState("开启手势");
  const [muted, setMuted] = useState(false);
  const [name, setName] = useState("亲爱的你");
  const [blessing, setBlessing] = useState("愿你眼里有光，心中有爱，生日快乐，岁岁欢喜。");
  const [cards, setCards] = useState<Card[]>(INITIAL_CARDS);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [motionSeen, setMotionSeen] = useState(false);
  const [orbit, setOrbit] = useState({ yaw: 0, pitch: 0.06 });

  const transition = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const morphTo = useCallback((kind: string, text?: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    targetKindRef.current = kind;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const points = pointsRef.current;
    if (kind === "text" && text) {
      const targets = makeTextTargets(text, width, height, points.length);
      points.forEach((p, i) => {
        p.tx = targets[i].x;
        p.ty = targets[i].y;
      });
    } else if (kind === "cake") {
      const targets = makeCakeTargets(width, height, points.length);
      points.forEach((p, i) => {
        p.tx = targets[i].x;
        p.ty = targets[i].y;
        p.hue = [176, 211, 248, 282][i % 4] + Math.random() * 13;
      });
    } else if (kind === "stars") {
      points.forEach((p) => {
        p.tx = Math.random() * width;
        p.ty = Math.random() * height;
      });
    }
  }, []);

  const clearSequence = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const launchFireworks = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bursts = [
      [0.18, 0.38, 330], [0.82, 0.32, 175], [0.5, 0.42, 265],
      [0.31, 0.24, 195], [0.69, 0.22, 315],
    ];
    bursts.forEach(([px, py, hue], burstIndex) => {
      const timer = window.setTimeout(() => {
        for (let i = 0; i < 180; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.4 + Math.random() * 4.7;
          fireworksRef.current.push({
            x: width * px,
            y: height * py,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.8 + Math.random() * 0.5,
            hue: hue + Math.random() * 35,
          });
        }
      }, burstIndex * 330);
      timersRef.current.push(timer);
    });
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
      targetKindRef.current = "sphere";
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

  const toggleCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraOn(false);
      setCameraHint("开启手势");
      return;
    }
    try {
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
      setCameraHint("挥手控制");
    } catch {
      setCameraHint("请允许相机");
      window.setTimeout(() => setCameraHint("开启手势"), 2200);
    }
  }, []);

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

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const count = window.innerWidth < 700 ? 1200 : 2200;
    const points: Point[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!points.length) {
        for (let i = 0; i < count; i++) {
          const x = Math.random() * width;
          const y = Math.random() * height;
          points.push({
            x, y, tx: x, ty: y, z: Math.random() * 2 - 1,
            size: 0.7 + Math.random() * 1.7,
            hue: [168, 204, 246, 280][(Math.random() * 4) | 0] + Math.random() * 20,
          });
        }
        pointsRef.current = points;
      } else {
        morphTo(stageRef.current === "cake" ? "cake" : "stars");
      }
    };
    resize();
    window.addEventListener("resize", resize);

    let last = performance.now();
    const draw = (time: number) => {
      const dt = Math.min(2, (time - last) / 16.67);
      last = time;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createRadialGradient(width * 0.5, height * 0.48, 30, width * 0.5, height * 0.5, Math.max(width, height) * 0.65);
      gradient.addColorStop(0, "rgba(43,54,124,.12)");
      gradient.addColorStop(0.5, "rgba(9,13,38,.06)");
      gradient.addColorStop(1, "rgba(0,0,8,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const isSphere = stageRef.current === "gallery";
      if (isSphere) {
        if (!orbitPausedRef.current) yawTargetRef.current += 0.0014 * dt;
        yawRef.current += (yawTargetRef.current - yawRef.current) * 0.055 * dt;
        pitchRef.current += (pitchTargetRef.current - pitchRef.current) * 0.05 * dt;
      }
      const radius = Math.min(width, height) * (window.innerWidth < 700 ? 0.34 : 0.38);
      const cx = width / 2;
      const cy = height / 2 + (window.innerWidth < 700 ? 8 : 30);
      points.forEach((p, i) => {
        if (isSphere) {
          const phi = Math.acos(-1 + (2 * i) / points.length);
          const theta = Math.sqrt(points.length * Math.PI) * phi + yawRef.current;
          const x3 = Math.cos(theta) * Math.sin(phi);
          const y3 = Math.cos(phi);
          const z3 = Math.sin(theta) * Math.sin(phi);
          const cp = Math.cos(pitchRef.current);
          const sp = Math.sin(pitchRef.current);
          const ry = y3 * cp - z3 * sp;
          const rz = y3 * sp + z3 * cp;
          const perspective = 0.82 + (rz + 1) * 0.12;
          p.tx = cx + x3 * radius * perspective;
          p.ty = cy + ry * radius * perspective;
          p.z = rz;
        }
        p.x += (p.tx - p.x) * (isSphere ? 0.065 : 0.085) * dt;
        p.y += (p.ty - p.y) * (isSphere ? 0.065 : 0.085) * dt;
        const twinkle = 0.42 + Math.sin(time * 0.0022 + i * 1.7) * 0.25;
        const isCake = stageRef.current === "cake";
        const alpha = clamp(twinkle + (isSphere ? (p.z + 1) * 0.17 : isCake ? .34 : 0.12), 0.12, 1);
        const size = p.size * (isSphere ? 0.72 + (p.z + 1) * 0.35 : isCake ? 1.36 : 1);
        if (i % 31 === 0) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = `hsla(${p.hue},95%,75%,.8)`;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = `hsla(${p.hue},95%,${isSphere ? 72 : 78}%,${alpha})`;
        ctx.fillRect(p.x, p.y, size, size);
      });
      ctx.shadowBlur = 0;

      if (stageRef.current === "cake") {
        ctx.save();
        ctx.translate(cx, cy + Math.min(55, height * 0.07));
        ctx.strokeStyle = "rgba(116,246,228,.34)";
        ctx.lineWidth = 1;
        for (let ring = 0; ring < 3; ring++) {
          ctx.beginPath();
          ctx.ellipse(0, 20 + ring * 32, (190 + ring * 48) * Math.min(width / 780, 1), 34 + ring * 8, Math.sin(time * .00035 + ring) * .1, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      fireworksRef.current = fireworksRef.current.filter((f) => {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 0.035 * dt;
        f.vx *= 0.993;
        f.life -= 0.0095 * dt;
        if (f.life <= 0) return false;
        ctx.fillStyle = `hsla(${f.hue},100%,78%,${f.life})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `hsla(${f.hue},100%,70%,.8)`;
        ctx.fillRect(f.x, f.y, 2.2, 2.2);
        return true;
      });
      ctx.shadowBlur = 0;
      animationRef.current = requestAnimationFrame(draw);
    };
    animationRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [morphTo]);

  useEffect(() => {
    if (!cameraOn) return;
    const video = videoRef.current;
    if (!video) return;
    const sample = document.createElement("canvas");
    sample.width = 64;
    sample.height = 48;
    const sctx = sample.getContext("2d", { willReadFrequently: true })!;
    let previous: Uint8ClampedArray | null = null;
    let waveScore = 0;
    const timer = window.setInterval(() => {
      if (video.readyState < 2) return;
      sctx.save();
      sctx.scale(-1, 1);
      sctx.drawImage(video, -64, 0, 64, 48);
      sctx.restore();
      const current = sctx.getImageData(0, 0, 64, 48).data;
      if (previous) {
        let sum = 0;
        let weightedX = 0;
        let weightedY = 0;
        let active = 0;
        for (let y = 0; y < 48; y += 2) {
          for (let x = 0; x < 64; x += 2) {
            const i = (y * 64 + x) * 4;
            const diff = Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1]) + Math.abs(current[i + 2] - previous[i + 2]);
            if (diff > 72) {
              sum += diff;
              weightedX += x * diff;
              weightedY += y * diff;
              active++;
            }
          }
        }
        if (sum > 0) {
          const mx = weightedX / sum / 64;
          const my = weightedY / sum / 48;
          yawTargetRef.current = (mx - 0.5) * -2.8;
          pitchTargetRef.current = clamp((my - 0.5) * 1.5, -0.65, 0.65);
        }
        waveScore = waveScore * 0.76 + active * 0.24;
        if (waveScore > 95) {
          setMotionSeen(true);
          if (stageRef.current === "cake") toggleGallery();
        }
      }
      previous = new Uint8ClampedArray(current);
    }, 130);
    return () => window.clearInterval(timer);
  }, [cameraOn, toggleGallery]);

  useEffect(() => () => {
    clearSequence();
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
          <button className={`icon-button ${cameraOn ? "active" : ""}`} onClick={toggleCamera} aria-label="开启摄像头手势">
            <span className="hand-icon">✋</span><span className="action-label">{cameraHint}</span>
          </button>
        </div>
      </header>

      <div className={`camera-preview ${cameraOn ? "" : "off"} ${motionSeen ? "motion-seen" : ""}`}>
        <video ref={videoRef} muted playsInline />
        <span>{motionSeen ? "已识别手势" : "在镜头前挥手"}</span>
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
            <p>{stage === "cake" ? "点击按钮或在镜头前挥手" : "拖动旋转 · 点击照片 · 挥手也可以控制"}</p>
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
