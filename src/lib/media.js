/**
 * Shared, browser-independent size calculations and format helpers.
 * The old application used 50 * 1024 * 1024 (50 MiB). A strict service-side
 * 50 MB limit can be decimal, so we use 50,000,000 bytes to stay conservative.
 */
export const LIMIT_BYTES = 50_000_000;
export const STOP_AT_BYTES = 46_000_000; // Leaves room for delayed/final recorder chunks.
export const AUDIO_BPS = 64_000;

export function formatBytes(value = 0) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function formatDuration(seconds = 0) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// We request a conservative average bitrate for the desired clip length.
// Browser encoders may ignore the requested bitrate; live measured bytes are authoritative.
export function suggestedVideoBitrate(minutes, audioEnabled = true) {
  const seconds = Math.max(1, Number(minutes) || 5) * 60;
  const budgetBps = (STOP_AT_BYTES * 8 * 0.88) / seconds;
  return Math.round(clamp(budgetBps - (audioEnabled ? AUDIO_BPS : 0), 160_000, 6_000_000));
}

export function estimateSizeBytes(seconds, videoBps, audioEnabled = true) {
  return Math.round((Math.max(0, seconds) * (videoBps + (audioEnabled ? AUDIO_BPS : 0))) / 8);
}

export function estimatedMinutes(videoBps, audioEnabled = true) {
  return Math.max(0, (STOP_AT_BYTES * 8) / (videoBps + (audioEnabled ? AUDIO_BPS : 0)) / 60);
}

export function pickRecordingMime(isSupported = () => false) {
  // MP4 is preferred for services such as GorillaDesk, but not all mobile
  // browsers implement MP4 encoding. A filename extension never converts a codec.
  const options = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return options.find((mime) => {
    try { return isSupported(mime); } catch { return false; }
  }) || '';
}

export function preferredMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return pickRecordingMime((mime) => MediaRecorder.isTypeSupported(mime));
}

export function extensionForMime(mime = '') {
  if (/mp4/i.test(mime)) return 'mp4';
  if (/webm/i.test(mime)) return 'webm';
  if (/quicktime/i.test(mime)) return 'mov';
  return 'video'; // Do not pretend an unknown encoding is MP4.
}

export function scaledDimensions(width, height, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
  // Even output dimensions are safest with hardware H.264 encoders.
  return {
    width: Math.max(2, Math.floor(width * scale / 2) * 2),
    height: Math.max(2, Math.floor(height * scale / 2) * 2),
  };
}

export function safeFileName(label = 'capture') {
  return String(label).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'capture';
}

export function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const clean = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const result = {
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      clean();
      resolve(result);
    };
    video.onerror = () => { clean(); reject(new Error('Unable to read this video. Try an MP4 or MOV supported by your browser.')); };
    video.src = url;
  });
}
