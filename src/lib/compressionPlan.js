import { AUDIO_BPS, LIMIT_BYTES, clamp, scaledDimensions } from './media.js';

// MediaRecorder bitrate requests are estimates, not hard byte caps. Planning
// conservatively is the only portable single-pass approach in mobile browsers.
export const SINGLE_PASS_TARGET_BYTES = 42_500_000;
export const MAX_OUTPUT_BYTES = LIMIT_BYTES;
const MIN_VIDEO_BPS = 65_000;
const MIN_AUDIO_BPS = 24_000;

const QUALITY_LEVELS = [
  { width: 1920, height: 1080, minimumBpp: 0.095 },
  { width: 1280, height: 720, minimumBpp: 0.088 },
  { width: 854, height: 480, minimumBpp: 0.075 },
  { width: 640, height: 360, minimumBpp: 0.068 },
  { width: 426, height: 240, minimumBpp: 0.060 },
  { width: 320, height: 180, minimumBpp: 0 },
];

/**
 * Calculate the size target, bitrate, frame rate, and resolution before encoding.
 * The source is decoded only once, even when its original file is very large.
 */
export function createCompressionPlan(meta, settings = {}) {
  const duration = Number(meta?.duration);
  const sourceWidth = Number(meta?.width);
  const sourceHeight = Number(meta?.height);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(sourceWidth) || sourceWidth < 2 || !Number.isFinite(sourceHeight) || sourceHeight < 2) {
    throw new Error('Video duration or dimensions are unavailable. Try a different browser-supported MP4 or MOV.');
  }

  const totalBps = Math.floor(SINGLE_PASS_TARGET_BYTES * 8 / duration);
  if (totalBps < MIN_VIDEO_BPS + MIN_AUDIO_BPS) {
    throw new Error('This clip is too long to fit reliably in one browser compression pass. Split it into shorter clips or use a desktop encoder.');
  }

  // Reserve enough room for audio, but let video quality use most of the budget.
  const audioBps = Math.floor(clamp(totalBps * 0.15, MIN_AUDIO_BPS, AUDIO_BPS));
  const videoBps = Math.floor(clamp(totalBps - audioBps, MIN_VIDEO_BPS, 4_000_000));
  const [presetW, presetH] = String(settings.convertResolution || '854x480').split('x').map(Number);
  const maxW = Number.isFinite(presetW) && presetW > 1 ? presetW : 854;
  const maxH = Number.isFinite(presetH) && presetH > 1 ? presetH : 480;
  const preferredFps = clamp(Number(settings.fps) || 24, 12, 30);
  // Very low bitrates are easier for phones to sustain at reduced frame rates.
  const fps = videoBps < 180_000 ? Math.min(15, preferredFps) : videoBps < 350_000 ? Math.min(20, preferredFps) : Math.min(24, preferredFps);
  const candidates = QUALITY_LEVELS.map((level) => ({
    ...level,
    dimensions: scaledDimensions(sourceWidth, sourceHeight, Math.min(maxW, level.width), Math.min(maxH, level.height)),
  }));
  const chosen = candidates.find(({ dimensions, minimumBpp }) =>
    videoBps / (dimensions.width * dimensions.height * fps) >= minimumBpp,
  ) || candidates[candidates.length - 1];

  return {
    duration, dimensions: chosen.dimensions, fps, videoBps, audioBps,
    targetBytes: SINGLE_PASS_TARGET_BYTES, maxBytes: MAX_OUTPUT_BYTES,
    estimatedSeconds: Math.ceil(duration),
  };
}
