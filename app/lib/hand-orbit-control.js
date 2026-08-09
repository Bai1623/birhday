const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const HAND_MOTION_RESET_MS = 360;
export const HAND_RETURN_LOCK_MS = 1100;
export const HAND_RETURN_RELEASE_TRAVEL = 0.085;
export const HAND_SWIPE_MIN_TRAVEL = 0.12;
export const HAND_SWIPE_MAX_MS = 900;
export const HAND_SWIPE_COOLDOWN_MS = 280;
export const HAND_YAW_DELTA_GAIN = 8.2;
export const HAND_PITCH_DELTA_GAIN = 5.4;

const createMotionState = (x, y, time) => ({
  x,
  y,
  time,
  anchorX: x,
  anchorY: y,
  anchorTime: time,
  lastSwipeDirection: 0,
  lastSwipeTime: -Infinity,
  returnLockDirection: 0,
  returnLockOriginX: x,
});

export function applyHandOrbitControl(motion, x, y, time, applyDelta) {
  if (!motion || time - motion.time > HAND_MOTION_RESET_MS) {
    return createMotionState(x, y, time);
  }

  const dx = clamp(x - motion.x, -0.16, 0.16);
  const dy = clamp(y - motion.y, -0.14, 0.14);
  let anchorX = motion.anchorX;
  let anchorY = motion.anchorY;
  let anchorTime = motion.anchorTime;
  let returnLockDirection = motion.returnLockDirection ?? 0;
  let returnLockOriginX = motion.returnLockOriginX ?? motion.x;
  let yawDelta = dx * HAND_YAW_DELTA_GAIN;

  if (returnLockDirection !== 0) {
    const lockActive = time - motion.lastSwipeTime <= HAND_RETURN_LOCK_MS;
    const movingThroughReturn = Math.sign(dx) === returnLockDirection;
    const returnTravel = (x - returnLockOriginX) * returnLockDirection;
    const resetForNextSwipe = returnTravel >= HAND_RETURN_RELEASE_TRAVEL || !lockActive;

    if (lockActive && movingThroughReturn) {
      yawDelta = 0;
    }
    if (resetForNextSwipe) {
      returnLockDirection = 0;
      returnLockOriginX = x;
      anchorX = x;
      anchorY = y;
      anchorTime = time;
    }
  }

  applyDelta(yawDelta, dy * HAND_PITCH_DELTA_GAIN);

  const anchorDx = x - anchorX;
  const anchorDt = time - anchorTime;
  const canTriggerSwipe =
    returnLockDirection === 0 &&
    Math.abs(anchorDx) >= HAND_SWIPE_MIN_TRAVEL &&
    anchorDt <= HAND_SWIPE_MAX_MS &&
    time - motion.lastSwipeTime >= HAND_SWIPE_COOLDOWN_MS;

  if (canTriggerSwipe) {
    const direction = Math.sign(anchorDx);
    const swipeYawImpulse = direction * (0.62 + Math.min(Math.abs(anchorDx), 0.38) * 2.1);
    applyDelta(swipeYawImpulse, 0);
    return {
      x,
      y,
      time,
      anchorX: x,
      anchorY: y,
      anchorTime: time,
      lastSwipeDirection: direction,
      lastSwipeTime: time,
      returnLockDirection: -direction,
      returnLockOriginX: x,
    };
  }

  const shouldResetAnchor = anchorDt > HAND_SWIPE_MAX_MS || Math.abs(x - anchorX) < 0.035;
  return {
    x,
    y,
    time,
    anchorX: shouldResetAnchor ? x : anchorX,
    anchorY: shouldResetAnchor ? y : anchorY,
    anchorTime: shouldResetAnchor ? time : anchorTime,
    lastSwipeDirection: motion.lastSwipeDirection,
    lastSwipeTime: motion.lastSwipeTime,
    returnLockDirection,
    returnLockOriginX,
  };
}
