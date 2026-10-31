import { onBeforeUnmount, ref } from 'vue';
import {
  AUDIO_BPS, LIMIT_BYTES, STOP_AT_BYTES, clamp, preferredMime,
  readVideoMetadata, scaledDimensions,
} from '../lib/media.js';

/**
 * Upload conversion is deliberately separate from live recording.
 * Live capture is encoded by MediaRecorder as it happens; uploaded videos need
 * decode -> draw to canvas -> MediaRecorder re-encode (in real playback time).
 * No CDN, server, maps, FFmpeg download, or external video upload is involved.
 */
export function useCompressor(settings) {
  const file = ref(null);
  const metadata = ref(null);
  const busy = ref(false);
  const progress = ref(0);
  const attempt = ref(0);
  const error = ref('');
  const notice = ref('');
  const result = ref(null);
  const outputMime = ref('');
  const previewUrl = ref('');
  const supported = typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

  let activeJob = null;
  let convertVideo = null;

  function cleanupFilePreview() {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }

  async function selectFile(nextFile) {
    if (busy.value) return;
    error.value = '';
    notice.value = '';
    result.value = null;
    metadata.value = null;
    cleanupFilePreview();
    file.value = nextFile || null;
    if (!nextFile) return;
    if (!nextFile.type.startsWith('video/') && !/\.(mov|mp4|webm|m4v|mkv)$/i.test(nextFile.name)) {
      error.value = 'Choose a video file (MP4, MOV, WebM or a browser-supported format).';
      file.value = null;
      return;
    }
    previewUrl.value = URL.createObjectURL(nextFile);
    try { metadata.value = await readVideoMetadata(nextFile); }
    catch (cause) { error.value = cause.message; }
  }

  function cancel() {
    if (activeJob) {
      activeJob.cancelled = true;
      convertVideo?.pause();
    }
  }

  async function convert(source = file.value, { force = false } = {}) {
    if (busy.value || !source) return;
    error.value = '';
    notice.value = '';
    result.value = null;
    outputMime.value = '';
    progress.value = 0;
    attempt.value = 0;
    const job = { cancelled: false };
    activeJob = job;
    busy.value = true;

    try {
      // Avoid fragile/unnecessary iOS re-encoding when a selected video
      // already fits the upload limit. Preserve the source container and
      // warn via ResultCard if the receiving system specifically needs MP4.
      if (!force && source.size <= LIMIT_BYTES) {
        result.value = source;
        outputMime.value = source.type;
        progress.value = 100;
        notice.value = 'Already under 50 MB — original video preserved without recompression. Confirm the receiving service accepts this format.';
        return;
      }
      if (!supported || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot re-encode a large video (Canvas/MediaRecorder unavailable). Record a new compressed take instead.');
      const outMime = preferredMime();
      if (!outMime) throw new Error('Your browser has no compatible video encoder.');
      const meta = source === file.value ? (metadata.value || await readVideoMetadata(source)) : await readVideoMetadata(source);
      if (!meta.duration || !meta.width || !meta.height) throw new Error('Cannot determine this video’s duration or dimensions.');

      // Default 43 MB budget provides a safer margin for browser bitrate drift.
      const totalBitsPerSec = (43_000_000 * 8) / meta.duration;
      let videoBps = Math.round(clamp(totalBitsPerSec * 0.87 - AUDIO_BPS, 150_000, 4_500_000));
      const [maxW, maxH] = settings.convertResolution.split('x').map(Number);
      let dimensions = scaledDimensions(meta.width, meta.height, maxW, maxH);
      let lastBlob = null;
      let lastHadAudio = true;

      for (let n = 1; n <= 3; n++) {
        if (job.cancelled) throw new Error('Conversion cancelled.');
        attempt.value = n;
        progress.value = 0;
        const output = await transcodeOnce({
          source, job, dimensions, videoBps, fps: Number(settings.fps) || 24,
          onProgress: (fraction) => { progress.value = Math.floor(clamp(fraction, 0, 1) * 100); },
          setVideo: (element) => { convertVideo = element; },
        });
        if (job.cancelled) throw new Error('Conversion cancelled.');
        lastBlob = output.blob;
        lastHadAudio = output.hadAudio;
        if (lastBlob.size <= LIMIT_BYTES) break;
        videoBps = Math.max(110_000, Math.floor(videoBps * 0.65));
        dimensions = scaledDimensions(dimensions.width, dimensions.height, Math.max(320, dimensions.width * 0.75), Math.max(180, dimensions.height * 0.75));
      }

      if (!lastBlob || !lastBlob.size) throw new Error('Encoder returned an empty video.');
      result.value = lastBlob;
      outputMime.value = lastBlob.type;
      progress.value = 100;
      if (lastBlob.size > LIMIT_BYTES) {
        notice.value = 'Still exceeds 50 MB after three passes. Try a shorter clip or a smaller resolution.';
      } else {
        notice.value = `Compressed successfully in ${attempt.value} pass${attempt.value > 1 ? 'es' : ''}.`;
      }
      if (!lastHadAudio) notice.value += ' Audio could not be captured; output may be silent.';
    } catch (cause) {
      error.value = cause?.message || 'Video compression failed.';
    } finally {
      activeJob = null;
      convertVideo = null;
      busy.value = false;
    }
  }

  onBeforeUnmount(() => { cancel(); cleanupFilePreview(); });

  return {
    file, metadata, busy, progress, attempt, error, notice, result,
    outputMime, previewUrl, supported, selectFile, convert, cancel,
  };
}

async function transcodeOnce({ source, job, dimensions, videoBps, fps, onProgress, setVideo }) {
  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  let canvasStream = null;
  let audioContext = null;
  let audioDestination = null;
  let audioTrack = null;
  let recorder = null;
  let raf = null;
  let endedCleanup = null;
  let recordingFinished = null;
  let hadAudio = true;

  try {
    // Off-screen rather than display:none: some mobile browsers won't decode
    // non-rendered media, causing a blank canvas or stalled conversion.
    video.setAttribute('playsinline', '');
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:-5px;top:-5px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1';
    video.src = sourceUrl;
    document.body.appendChild(video);
    setVideo(video);
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Browser cannot decode the source video.'));
    });
    if (job.cancelled) throw new Error('Conversion cancelled.');

    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not create video canvas.');
    canvasStream = canvas.captureStream(fps);

    // Audio is routed into a MediaStreamDestination, not the speakers.
    // This retains sound on browsers that support Web Audio video sources.
    try {
      const AudioConstructor = window.AudioContext || window.webkitAudioContext;
      if (AudioConstructor) {
        audioContext = new AudioConstructor();
        const sourceNode = audioContext.createMediaElementSource(video);
        audioDestination = audioContext.createMediaStreamDestination();
        sourceNode.connect(audioDestination);
        const silentMonitor = audioContext.createGain();
        silentMonitor.gain.value = 0;
        sourceNode.connect(silentMonitor);
        silentMonitor.connect(audioContext.destination);
        await audioContext.resume();
        audioTrack = audioDestination.stream.getAudioTracks()[0] || null;
      }
    } catch {
      // Alternate captureStream() path may supply audio after playback begins.
      audioTrack = null;
    }

    video.muted = false;
    // Start playback from this user-initiated conversion interaction.
    await video.play().catch(() => { throw new Error('Video playback was blocked. Tap Convert again and keep the page visible.'); });
    if (!audioTrack) {
      try { audioTrack = video.captureStream?.().getAudioTracks()[0] || null; } catch { /* Not exposed. */ }
    }
    hadAudio = !!audioTrack;
    const tracks = [...canvasStream.getVideoTracks(), ...(audioTrack ? [audioTrack] : [])];
    const combined = new MediaStream(tracks);
    const mimeType = preferredMime();
    recorder = new MediaRecorder(combined, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: videoBps,
      ...(audioTrack ? { audioBitsPerSecond: AUDIO_BPS } : {}),
    });
    const chunks = [];
    recorder.ondataavailable = ({ data }) => { if (data?.size) chunks.push(data); };
    recordingFinished = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = (event) => reject(new Error(event.error?.message || 'Encoder error.'));
    });
    const duration = video.duration;
    const onEnded = new Promise((resolve, reject) => {
      function done() { detach(); resolve(); }
      function failed() { detach(); reject(new Error('Could not finish playing the video during conversion.')); }
      function detach() { video.removeEventListener('ended', done); video.removeEventListener('error', failed); }
      endedCleanup = detach;
      video.addEventListener('ended', done);
      video.addEventListener('error', failed);
    });

    // Drive the canvas at a capped framerate, maintaining aspect ratio.
    const draw = () => {
      if (job.cancelled) { video.pause(); return; }
      const w = video.videoWidth || dimensions.width;
      const h = video.videoHeight || dimensions.height;
      const ratio = Math.min(dimensions.width / w, dimensions.height / h);
      const drawW = w * ratio;
      const drawH = h * ratio;
      context.fillStyle = '#000';
      context.fillRect(0, 0, dimensions.width, dimensions.height);
      context.drawImage(video, (dimensions.width - drawW) / 2, (dimensions.height - drawH) / 2, drawW, drawH);
      onProgress(duration > 0 ? video.currentTime / duration : 0);
      raf = requestAnimationFrame(draw);
    };
    // Draw at least one frame before asking the encoder to capture it.
    draw();
    recorder.start(800);

    // Checking cancellation explicitly avoids waiting indefinitely for 'ended'
    // when Cancel pauses the invisible source element.
    await Promise.race([
      onEnded,
      new Promise((_, reject) => {
        const poll = () => {
          if (job.cancelled) { reject(new Error('Conversion cancelled.')); return; }
          if (video.ended || video.error) return;
          const id = setTimeout(poll, 100);
          // Make the timer inaccessible after completion; one last tick is harmless.
          void id;
        };
        poll();
      }),
    ]);
    if (recorder.state !== 'inactive') recorder.stop();
    await recordingFinished;
    return { blob: new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }), hadAudio };
  } finally {
    // Cancel/retry must always relinquish every camera, audio and object URL resource.
    if (raf != null) cancelAnimationFrame(raf);
    endedCleanup?.();
    try { if (recorder?.state !== 'inactive') recorder.stop(); } catch { /* No-op. */ }
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    canvasStream?.getTracks().forEach((track) => track.stop());
    audioDestination?.stream?.getTracks().forEach((track) => track.stop());
    try { await audioContext?.close(); } catch { /* Audio already closed. */ }
    URL.revokeObjectURL(sourceUrl);
  }
}
