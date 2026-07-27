import * as THREE from "three";

type ParticleMode = "stars" | "text" | "cake" | "sphere";
type FireworkIntensity = "normal" | "grand" | "cake";

type FireworkParticle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  size: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const hslToRgb = (hue: number, saturation = 0.95, lightness = 0.74) => {
  const h = ((hue % 360) + 360) % 360 / 360;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const hueToRgb = (tInput: number) => {
    let t = tInput;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hueToRgb(h + 1 / 3), hueToRgb(h), hueToRgb(h - 1 / 3)];
};

function makeTextTargets(text: string, width: number, height: number, count: number) {
  const surface = document.createElement("canvas");
  surface.width = Math.min(900, Math.max(360, Math.floor(width * 0.78)));
  const isNumber = text.length === 1;
  surface.height = isNumber ? 390 : 280;
  const ctx = surface.getContext("2d");
  if (!ctx) return new Float32Array(count * 3);

  ctx.clearRect(0, 0, surface.width, surface.height);
  ctx.font = `800 ${isNumber ? 320 : clamp(surface.width / 5, 92, 150)}px "PingFang SC","Microsoft YaHei",sans-serif`;
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

  const result = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = candidates[(Math.random() * candidates.length) | 0] ?? { x: surface.width / 2, y: surface.height / 2 };
    result[i * 3] = p.x - surface.width / 2;
    result[i * 3 + 1] = height * 0.5 - (height * 0.5 + p.y - surface.height / 2);
    result[i * 3 + 2] = 0;
  }
  return result;
}

function makeCakeTargets(width: number, height: number, count: number) {
  const cy = height / 2 + Math.min(55, height * 0.07);
  const scale = Math.min(width / 780, height / 720, 1.18);
  const targets = new Float32Array(count * 3);
  const tiers = [
    { y: 91, w: 245, h: 76 },
    { y: 9, w: 190, h: 70 },
    { y: -66, w: 135, h: 62 },
  ];

  for (let i = 0; i < count; i++) {
    const index = i * 3;
    if (i >= count - 80) {
      const a = Math.random() * Math.PI * 2;
      const r = (7 + Math.random() * 13) * scale;
      const spike = Math.random() > 0.45 ? 1.8 : 1;
      targets[index] = Math.cos(a) * r * spike;
      targets[index + 1] = height / 2 - (cy + (-170 + Math.sin(a) * r * spike) * scale);
      targets[index + 2] = 0;
      continue;
    }
    if (i >= count - 180) {
      targets[index] = (Math.random() - 0.5) * 18 * scale;
      targets[index + 1] = height / 2 - (cy + (-160 + Math.random() * 66) * scale);
      targets[index + 2] = 0;
      continue;
    }

    const choice = Math.random();
    const tier = choice < 0.42 ? tiers[0] : choice < 0.75 ? tiers[1] : tiers[2];
    const onTop = Math.random() < 0.24;
    let x: number;
    let y: number;
    if (onTop) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random());
      x = Math.cos(angle) * tier.w * radius;
      y = tier.y - tier.h / 2 + Math.sin(angle) * 18 * radius;
    } else {
      x = (Math.random() * 2 - 1) * tier.w;
      y = tier.y + (Math.random() - 0.5) * tier.h;
    }
    targets[index] = x * scale;
    targets[index + 1] = height / 2 - (cy + y * scale);
    targets[index + 2] = 0;
  }

  return targets;
}

const particleVertexShader = `
  uniform float uPixelRatio;
  attribute vec3 particleColor;
  attribute float particleAlpha;
  attribute float particleSize;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = particleSize * uPixelRatio;
    vColor = particleColor;
    vAlpha = particleAlpha;
  }
`;

const particleFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;
    float alpha = smoothstep(0.5, 0.16, dist) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class ParticleScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  private geometry = new THREE.BufferGeometry();
  private fireworkGeometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private fireworkMaterial: THREE.ShaderMaterial;
  private points: THREE.Points;
  private fireworksMesh: THREE.Points;
  private positions: Float32Array;
  private targets: Float32Array;
  private colors: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private fireworkPositions: Float32Array;
  private fireworkColors: Float32Array;
  private fireworkAlphas: Float32Array;
  private fireworkSizes: Float32Array;
  private fireworks: FireworkParticle[] = [];
  private width = 1;
  private height = 1;
  private mode: ParticleMode = "stars";

  constructor(private canvas: HTMLCanvasElement, private count: number) {
    this.positions = new Float32Array(count * 3);
    this.targets = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    this.sizes = new Float32Array(count);

    const maxFireworks = 4500;
    this.fireworkPositions = new Float32Array(maxFireworks * 3);
    this.fireworkColors = new Float32Array(maxFireworks * 3);
    this.fireworkAlphas = new Float32Array(maxFireworks);
    this.fireworkSizes = new Float32Array(maxFireworks);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      uniforms: { uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fireworkMaterial = this.material.clone();

    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("particleColor", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("particleAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute("particleSize", new THREE.BufferAttribute(this.sizes, 1));
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);

    this.fireworkGeometry.setAttribute("position", new THREE.BufferAttribute(this.fireworkPositions, 3));
    this.fireworkGeometry.setAttribute("particleColor", new THREE.BufferAttribute(this.fireworkColors, 3));
    this.fireworkGeometry.setAttribute("particleAlpha", new THREE.BufferAttribute(this.fireworkAlphas, 1));
    this.fireworkGeometry.setAttribute("particleSize", new THREE.BufferAttribute(this.fireworkSizes, 1));
    this.fireworksMesh = new THREE.Points(this.fireworkGeometry, this.fireworkMaterial);
    this.scene.add(this.fireworksMesh);

    this.resize();
    this.seedStars();
  }

  resize() {
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.left = -this.width / 2;
    this.camera.right = this.width / 2;
    this.camera.top = this.height / 2;
    this.camera.bottom = -this.height / 2;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uPixelRatio.value = dpr;
    this.fireworkMaterial.uniforms.uPixelRatio.value = dpr;
    if (this.mode !== "sphere") this.morphTo(this.mode);
  }

  morphTo(mode: ParticleMode, text?: string) {
    this.mode = mode;
    if (mode === "text" && text) this.targets = makeTextTargets(text, this.width, this.height, this.count);
    if (mode === "cake") this.targets = makeCakeTargets(this.width, this.height, this.count);
    if (mode === "stars") {
      for (let i = 0; i < this.count; i++) {
        this.targets[i * 3] = (Math.random() - 0.5) * this.width;
        this.targets[i * 3 + 1] = (Math.random() - 0.5) * this.height;
        this.targets[i * 3 + 2] = (Math.random() - 0.5) * 120;
      }
    }
    if (mode === "cake") this.recolorCake();
  }

  launchFireworks(intensity: FireworkIntensity = "normal") {
    const isMobile = this.width < 700;
    const grandBursts = [
      [-0.42, 0.24, 330],
      [-0.24, 0.18, 205],
      [0.0, 0.28, 270],
      [0.25, 0.2, 165],
      [0.44, 0.27, 315],
      [-0.36, -0.02, 52],
      [-0.13, 0.02, 190],
      [0.13, 0.04, 242],
      [0.36, -0.01, 28],
      [-0.04, -0.14, 300],
      [0.04, 0.12, 128],
      [-0.22, 0.08, 210],
      [0.22, 0.08, 250],
      [0.0, -0.18, 12],
      [-0.18, -0.2, 290],
      [0.18, -0.2, 310],
    ];
    const cakeBursts = [
      [-0.36, 0.1, 330],
      [-0.18, 0.18, 48],
      [0, 0.24, 210],
      [0.18, 0.18, 280],
      [0.36, 0.1, 150],
      [-0.26, -0.04, 198],
      [0.26, -0.04, 318],
    ];
    const normalBursts = [
      [-0.32, 0.12, 330],
      [0.32, 0.18, 175],
      [0, 0.08, 265],
      [-0.19, 0.26, 195],
      [0.19, 0.28, 315],
    ];
    const bursts = intensity === "grand" ? grandBursts : intensity === "cake" ? cakeBursts : normalBursts;
    const particlesPerBurst = intensity === "grand"
      ? (isMobile ? 230 : 340)
      : intensity === "cake"
        ? (isMobile ? 180 : 230)
        : (isMobile ? 140 : 180);
    const delayStep = intensity === "grand" ? 100 : intensity === "cake" ? 170 : 300;
    const baseLife = intensity === "grand" ? 1.15 : intensity === "cake" ? 0.92 : 0.8;
    const speedBase = intensity === "grand" ? 2 : intensity === "cake" ? 1.8 : 1.6;
    const speedSpread = intensity === "grand" ? 7.2 : intensity === "cake" ? 5.4 : 4.8;
    bursts.forEach(([px, py, hue], burstIndex) => {
      window.setTimeout(() => {
        for (let i = 0; i < particlesPerBurst; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = speedBase + Math.random() * speedSpread;
          const relativeSize = intensity === "grand" ? 2.6 : intensity === "cake" ? 2.2 : 2;
          this.fireworks.push({
            x: this.width * px,
            y: this.height * py,
            z: 80,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: baseLife + Math.random() * 0.65,
            hue: hue + Math.random() * 35,
            size: relativeSize + Math.random() * (isMobile ? 0.6 : 1.1),
          });
        }
      }, burstIndex * delayStep);
    });
  }

  render(time: number, dt: number, stage: "cake" | "gallery" | string, yaw: number, pitch: number) {
    const isSphere = stage === "gallery";
    if (isSphere) this.updateSphereTargets(yaw, pitch);

    const speed = (isSphere ? 0.065 : 0.085) * dt;
    for (let i = 0; i < this.count; i++) {
      const index = i * 3;
      this.positions[index] += (this.targets[index] - this.positions[index]) * speed;
      this.positions[index + 1] += (this.targets[index + 1] - this.positions[index + 1]) * speed;
      this.positions[index + 2] += (this.targets[index + 2] - this.positions[index + 2]) * speed;

      const depth = this.targets[index + 2] / 260;
      const twinkle = 0.42 + Math.sin(time * 0.0022 + i * 1.7) * 0.25;
      const alpha = clamp(twinkle + (isSphere ? (depth + 1) * 0.17 : stage === "cake" ? 0.34 : 0.12), 0.12, 1);
      this.alphas[i] = alpha;
      this.sizes[i] = (stage === "cake" ? 2.1 : isSphere ? 1.4 + (depth + 1) * 0.42 : 1.5) * (i % 31 === 0 ? 1.45 : 1);
    }

    this.updateFireworks(dt);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.particleAlpha.needsUpdate = true;
    this.geometry.attributes.particleSize.needsUpdate = true;
    this.fireworkGeometry.attributes.position.needsUpdate = true;
    this.fireworkGeometry.attributes.particleColor.needsUpdate = true;
    this.fireworkGeometry.attributes.particleAlpha.needsUpdate = true;
    this.fireworkGeometry.attributes.particleSize.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.fireworkGeometry.dispose();
    this.material.dispose();
    this.fireworkMaterial.dispose();
    this.renderer.dispose();
  }

  private seedStars() {
    for (let i = 0; i < this.count; i++) {
      const index = i * 3;
      this.positions[index] = (Math.random() - 0.5) * this.width;
      this.positions[index + 1] = (Math.random() - 0.5) * this.height;
      this.positions[index + 2] = (Math.random() - 0.5) * 120;
      this.targets[index] = this.positions[index];
      this.targets[index + 1] = this.positions[index + 1];
      this.targets[index + 2] = this.positions[index + 2];
      const [r, g, b] = hslToRgb([168, 204, 246, 280][(Math.random() * 4) | 0] + Math.random() * 20);
      this.colors[index] = r;
      this.colors[index + 1] = g;
      this.colors[index + 2] = b;
      this.alphas[i] = 0.5;
      this.sizes[i] = 0.9 + Math.random() * 1.7;
    }
  }

  private recolorCake() {
    for (let i = 0; i < this.count; i++) {
      const index = i * 3;
      const [r, g, b] = hslToRgb([176, 211, 248, 282][i % 4] + Math.random() * 13, 0.95, 0.76);
      this.colors[index] = r;
      this.colors[index + 1] = g;
      this.colors[index + 2] = b;
    }
    this.geometry.attributes.particleColor.needsUpdate = true;
  }

  private updateSphereTargets(yaw: number, pitch: number) {
    const radius = Math.min(this.width, this.height) * (window.innerWidth < 700 ? 0.34 : 0.38);
    const offsetY = window.innerWidth < 700 ? -8 : -30;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    for (let i = 0; i < this.count; i++) {
      const index = i * 3;
      const phi = Math.acos(-1 + (2 * i) / this.count);
      const theta = Math.sqrt(this.count * Math.PI) * phi + yaw;
      const x3 = Math.cos(theta) * Math.sin(phi);
      const y3 = Math.cos(phi);
      const z3 = Math.sin(theta) * Math.sin(phi);
      const ry = y3 * cp - z3 * sp;
      const rz = y3 * sp + z3 * cp;
      const perspective = 0.82 + (rz + 1) * 0.12;
      this.targets[index] = x3 * radius * perspective;
      this.targets[index + 1] = offsetY + ry * radius * perspective;
      this.targets[index + 2] = rz * 260;
    }
  }

  private updateFireworks(dt: number) {
    this.fireworks = this.fireworks.filter((firework) => {
      firework.x += firework.vx * dt;
      firework.y += firework.vy * dt;
      firework.vy -= 0.035 * dt;
      firework.vx *= 0.993;
      firework.life -= 0.0095 * dt;
      return firework.life > 0;
    }).slice(-this.fireworkAlphas.length);

    this.fireworkPositions.fill(0);
    this.fireworkAlphas.fill(0);
    this.fireworks.forEach((firework, i) => {
      const index = i * 3;
      this.fireworkPositions[index] = firework.x;
      this.fireworkPositions[index + 1] = firework.y;
      this.fireworkPositions[index + 2] = firework.z;
      const [r, g, b] = hslToRgb(firework.hue, 1, 0.78);
      this.fireworkColors[index] = r;
      this.fireworkColors[index + 1] = g;
      this.fireworkColors[index + 2] = b;
      this.fireworkAlphas[i] = firework.life;
      this.fireworkSizes[i] = firework.size * clamp(0.55 + firework.life * 0.55, 0.6, 1.4);
    });
  }
}
