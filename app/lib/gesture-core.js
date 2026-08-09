export const GESTURE_LABELS = {
  none: "未检测到手",
  open: "张开手掌",
  fist: "握拳",
  pinch: "捏合",
  point: "食指点选",
};

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];
const FINGER_MCPS = [5, 9, 13, 17];
const PALM_POINTS = [0, 5, 9, 13, 17];

const round3 = (value) => Math.round(value * 1000) / 1000;

export const distance = (a, b) => {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
};

export const getPalmCenter = (landmarks) => {
  const center = PALM_POINTS.reduce(
    (sum, index) => ({
      x: sum.x + landmarks[index].x,
      y: sum.y + landmarks[index].y,
    }),
    { x: 0, y: 0 },
  );
  return {
    x: round3(center.x / PALM_POINTS.length),
    y: round3(center.y / PALM_POINTS.length),
  };
};

export const getHandScale = (landmarks) =>
  Math.max(distance(landmarks[0], landmarks[9]), 0.001);

export const createEmaLandmarkSmoother = (alpha = 0.35) => {
  let previous = null;
  return (landmarks) => {
    if (!landmarks?.length) return previous;
    if (!previous || previous.length !== landmarks.length) {
      previous = landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z ?? 0 }));
      return previous;
    }
    previous = landmarks.map((point, index) => ({
      x: previous[index].x + (point.x - previous[index].x) * alpha,
      y: previous[index].y + (point.y - previous[index].y) * alpha,
      z: previous[index].z + ((point.z ?? 0) - previous[index].z) * alpha,
    }));
    return previous;
  };
};

const fingerExtensionScore = (landmarks, tipIndex, pipIndex, mcpIndex) => {
  const wrist = landmarks[0];
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];
  const mcp = landmarks[mcpIndex];
  const reachRatio = distance(wrist, tip) / Math.max(distance(wrist, mcp), 0.001);
  const verticalLift = (pip.y - tip.y) / getHandScale(landmarks);
  return reachRatio + verticalLift * 0.22;
};

export const classifyHand = (landmarks, previousGesture = "none") => {
  if (!landmarks || landmarks.length < 21) {
    return { gesture: "none", center: null, pinchRatio: 1, openness: 0 };
  }

  const handScale = getHandScale(landmarks);
  const center = getPalmCenter(landmarks);
  const pinchRatio = distance(landmarks[4], landmarks[8]) / handScale;
  const extensionScores = FINGER_TIPS.map((tip, index) =>
    fingerExtensionScore(landmarks, tip, FINGER_PIPS[index], FINGER_MCPS[index]),
  );
  const extendedCount = extensionScores.filter((score) => score > 1.34).length;
  const foldedCount = extensionScores.filter((score) => score < 1.18).length;
  const openness = extensionScores.reduce((sum, score) => sum + score, 0) / extensionScores.length;

  const pinchEnter = previousGesture === "pinch" ? 0.5 : 0.42;
  const strongPinchEnter = previousGesture === "pinch" ? 0.24 : 0.18;
  const pointEnter = previousGesture === "point" ? 1.22 : 1.32;
  const fistExit = previousGesture === "fist" ? 1.25 : 1.18;
  const openExit = previousGesture === "open" ? 1.25 : 1.34;
  const [indexScore, middleScore, ringScore, pinkyScore] = extensionScores;
  const pointFoldedCount = [middleScore, ringScore, pinkyScore].filter((score) => score < 1.2).length;

  if (pinchRatio < strongPinchEnter || (pinchRatio < pinchEnter && foldedCount < 4)) {
    return { gesture: "pinch", center, pinchRatio, openness };
  }
  if (indexScore > pointEnter && pointFoldedCount >= 2 && openness < openExit) {
    return { gesture: "point", center, pinchRatio, openness };
  }
  if (foldedCount >= 4 && openness < fistExit) {
    return { gesture: "fist", center, pinchRatio, openness };
  }
  if (extendedCount >= 4 && openness > openExit) {
    return { gesture: "open", center, pinchRatio, openness };
  }
  return { gesture: "none", center, pinchRatio, openness };
};

export class GestureGate {
  constructor({ requiredFrames = 6, cooldownMs = 800, lostHoldMs = 650 } = {}) {
    this.requiredFrames = requiredFrames;
    this.cooldownMs = cooldownMs;
    this.lostHoldMs = lostHoldMs;
    this.candidate = "none";
    this.frames = 0;
    this.confirmed = "none";
    this.lastEvent = null;
    this.lastSeenAt = 0;
  }

  update(gesture, timeMs) {
    const visibleGesture = gesture ?? "none";
    if (visibleGesture !== "none") this.lastSeenAt = timeMs;
    const heldGesture =
      visibleGesture === "none" && timeMs - this.lastSeenAt < this.lostHoldMs
        ? this.confirmed
        : visibleGesture;

    if (heldGesture !== this.candidate) {
      this.candidate = heldGesture;
      this.frames = 1;
    } else {
      this.frames += 1;
    }

    let event = null;
    if (
      heldGesture !== "none" &&
      this.frames >= this.requiredFrames &&
      timeMs - (this.lastEvent?.timeMs ?? -Infinity) >= this.cooldownMs &&
      this.confirmed !== heldGesture
    ) {
      this.confirmed = heldGesture;
      this.lastEvent = { gesture: heldGesture, timeMs };
      event = heldGesture;
    } else if (heldGesture === "none" && this.frames >= this.requiredFrames) {
      this.confirmed = "none";
    }

    return {
      event,
      stableGesture: this.confirmed,
      displayGesture: heldGesture,
      frames: this.frames,
    };
  }
}
