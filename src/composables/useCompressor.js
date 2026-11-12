import { onBeforeUnmount, ref } from 'vue';
import { LIMIT_BYTES, clamp, preferredMime, readVideoMetadata } from '../lib/media.js';
import { createCompressionPlan } from '../lib/compressionPlan.js';

/**
 * Browser-only video conversion. A single duration-aware plan is calculated
 * before playback: one decode / encode pass, no automatic repeats or uploads.
 * MediaRecorder cannot guarantee a strict file size; oversized results are
 * rejected explicitly instead of incorrectly being marked as ready to upload.
 */
export function useCompressor(settings) {
  const file = ref(null);
  const metadata = ref(null);
  const readingMetadata = ref(false);
  const busy = ref(false);
  const progress = ref(0);
  const stage = ref('idle');
  const statusDetail = ref('');
  const remainingSeconds = ref(null);
  const encodedBytes = ref(0);
  const plan = ref(null);
  const sourceLabel = ref('');
  const error = ref('');
  const notice = ref('');
  const result = ref(null);
  const outputMime = ref('');
  const previewUrl = ref('');
  const supported = typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && typeof MediaRecorder !== 'undefined';

  let activeJob = null;
  let selectionToken = 0;

  function cleanupFilePreview() {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }

  async function selectFile(nextFile) {
    if (busy.value) return;
    const token = ++selectionToken;
    error.value = '';
    notice.value = '';
    result.value = null;
    metadata.value = null;
    plan.value = null;
    stage.value = 'idle';
    progress.value = 0;
    cleanupFilePreview();
    file.value = nextFile || null;
    if (!nextFile) { readingMetadata.value = false; return; }
    if (!nextFile.type.startsWith('video/') && !/\.(mov|mp4|webm|m4v|mkv)$/i.test(nextFile.name)) {
      error.value = 'Choose a browser-supported video such as MP4, MOV or WebM.';
      file.value = null;
      return;
    }
    previewUrl.value = URL.createObjectURL(nextFile);
    readingMetadata.value = true;
    try {
      const nextMetadata = await readVideoMetadata(nextFile);
      if (token === selectionToken) metadata.value = nextMetadata;
    } catch (cause) {
      if (token === selectionToken) error.value = cause?.message || 'Could not load this video.';
    } finally {
      if (token === selectionToken) readingMetadata.value = false;
    }
  }

  function cancel() {
    // AbortController wakes pending playback, metadata and encoder waits. Merely
    // pausing the video used to strand the old conversion Promise indefinitely.
    activeJob?.controller.abort();
  }

  async function convert(source = file.value, { force = false, name = '' } = {}) {
    if (busy.value || !source) return;
    error.value = '';
    notice.value = '';
    result.value = null;
    outputMime.value = '';
    progress.value = 0;
    encodedBytes.value = 0;
    remainingSeconds.value = null;
    statusDetail.value = '';
    plan.value = null;
    sourceLabel.value = name || source.name || 'Video';
    const job = { controller: new AbortController() };
    activeJob = job;
    busy.value = true;
    stage.value = 'preparing';

    try {
      // Keep original audio/container/quality when the video already fits.
      if (!force && source.size <= LIMIT_BYTES) {
        result.value = source;
        outputMime.value = source.type;
        progress.value = 100;
        stage.value = 'done';
        notice.value = 'Already within 50 MB. Original file kept without re-encoding.';
        return;
      }
      if (!supported) throw new Error('This browser does not support local video re-encoding. Try a current Safari or Chrome browser.');
      const mimeType = preferredMime(); // Empty is fine: older Safari picks its native encoder.
      const sourceMeta = source === file.value && metadata.value
        ? metadata.value : await bounded(readVideoMetadata(source), 20_000, 'Reading video details', job.controller.signal);
      assertNotCancelled(job.controller.signal);
      const nextPlan = createCompressionPlan(sourceMeta, settings);
      plan.value = nextPlan;
      remainingSeconds.value = nextPlan.estimatedSeconds;
      statusDetail.value = `Preparing ${nextPlan.dimensions.width}×${nextPlan.dimensions.height} video · ${nextPlan.fps} FPS`;

      const output = await transcodeOnce({
        source, job, mimeType, plan: nextPlan,
        update: ({ fraction, remaining, bytes, phase, detail }) => {
          if (job.controller.signal.aborted) return;
          if (phase) stage.value = phase;
          if (detail != null) statusDetail.value = detail;
          if (fraction != null) progress.value = Math.floor(clamp(fraction, 0, 1) * 97);
          if (remaining != null) remainingSeconds.value = Math.max(0, Math.ceil(remaining));
          if (bytes != null) encodedBytes.value = bytes;
        },
      });
      assertNotCancelled(job.controller.signal);
      if (!output.blob.size) throw new Error('The browser produced an empty video. No original footage was changed.');
      if (output.blob.size > LIMIT_BYTES) {
        throw new Error(`This browser encoded ${Math.round(output.blob.size / 1_000_000)} MB despite the lower bitrate request. The original remains safe; select 240p in Settings or use a desktop encoder for this clip.`);
      }
      result.value = output.blob;
      outputMime.value = output.blob.type;
      progress.value = 100;
      remainingSeconds.value = 0;
      stage.value = 'done';
      statusDetail.value = 'Conversion complete';
      notice.value = 'Single-pass compression complete. Review the result before uploading.';
      if (!output.hadAudio) notice.value += ' This browser could not capture an audio track; the converted video may be silent.';
    } catch (cause) {
      if (job.controller.signal.aborted || cause?.name === 'AbortError') {
        stage.value = 'cancelled';
        notice.value = 'Conversion cancelled. Your original video is unchanged.';
      } else {
        stage.value = 'error';
        error.value = cause?.message || 'Video compression failed.';
      }
    } finally {
      if (activeJob === job) activeJob = null;
      busy.value = false;
    }
  }

  onBeforeUnmount(() => { cancel(); cleanupFilePreview(); });

  return {
    file, metadata, readingMetadata, busy, progress, stage, statusDetail, remainingSeconds,
    encodedBytes, plan, sourceLabel, error, notice, result, outputMime, previewUrl,
    supported, selectFile, convert, cancel,
  };
}

function cancelledError() {
  return new DOMException('Conversion cancelled.', 'AbortError');
}

function assertNotCancelled(signal) {
  if (signal.aborted) throw cancelledError();
}

/** Wait for a browser operation with a finite timeout and immediate cancellation. */
function bounded(promise, milliseconds, label, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(cancelledError());
    signal.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => finish(new Error(`${label} timed out. Keep the app open and phone awake, then retry.`)), milliseconds);
    if (signal.aborted) return abort();
    Promise.resolve(promise).then((value) => finish(null, value), (error) => finish(error));
  });
}

async function transcodeOnce({ source, job, mimeType, plan, update }) {
  const signal = job.controller.signal;
  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  let audioContext = null;
  let audioDestination = null;
  let canvasStream = null;
  let recorder = null;
  let animationId = null;
  let monitor = null;
  let onEndedCleanup = null;

  try {
    // Safari may suspend decoding for elements with display:none. A tiny
    // non-interactive element keeps decode alive without cluttering the UI.
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.001;pointer-events:none;z-index:-1';
    document.body.appendChild(video);

    const metadataReady = new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('Unable to decode this video in your browser.')), { once: true });
    });
    video.src = sourceUrl;
    video.load();
    await bounded(metadataReady, 20_000, 'Loading source video', signal);
    assertNotCancelled(signal);

    const canvas = document.createElement('canvas');
    canvas.width = plan.dimensions.width;
    canvas.height = plan.dimensions.height;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Could not initialize video conversion canvas.');
    canvasStream = canvas.captureStream(plan.fps);
    let audioTrack = null;

    // Convert media element audio to a MediaStreamDestination instead of
    // playing sound through the phone. This route works in Chromium and many
    // Safari releases; failures are clearly disclosed to the user.
    try {
      const AudioConstructor = window.AudioContext || window.webkitAudioContext;
      if (AudioConstructor) {
        audioContext = new AudioConstructor();
        const sourceNode = audioContext.createMediaElementSource(video);
        audioDestination = audioContext.createMediaStreamDestination();
        sourceNode.connect(audioDestination);
        // Never send the decoded source to the device speakers.
        const silentMonitor = audioContext.createGain();
        silentMonitor.gain.value = 0;
        sourceNode.connect(silentMonitor);
        silentMonitor.connect(audioContext.destination);
        await bounded(audioContext.resume(), 8_000, 'Starting audio conversion', signal);
        audioTrack = audioDestination.stream.getAudioTracks()[0] || null;
      }
    } catch (cause) {
      if (signal.aborted) throw cancelledError();
      audioTrack = null;
      // A blocked audio context should not prevent a usable video-only result.
      try { await audioContext?.close(); } catch { /* Best effort. */ }
      audioContext = null;
    }

    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...(audioTrack ? [audioTrack] : []),
    ]);
    const options = {
      videoBitsPerSecond: plan.videoBps,
      ...(audioTrack ? { audioBitsPerSecond: plan.audioBps } : {}),
      ...(mimeType ? { mimeType } : {}),
    };
    try {
      recorder = new MediaRecorder(combined, options);
    } catch {
      // Some iOS builds reject explicit MIME options despite reporting support.
      recorder = new MediaRecorder(combined, {
        videoBitsPerSecond: plan.videoBps,
        ...(audioTrack ? { audioBitsPerSecond: plan.audioBps } : {}),
      });
    }

    const chunks = [];
    let byteCount = 0;
    let recorderError = null;
    let finishRecorder;
    const recorderFinished = new Promise((resolve, reject) => {
      finishRecorder = { resolve, reject };
    });
    recorder.ondataavailable = ({ data }) => {
      if (!data?.size) return;
      chunks.push(data);
      byteCount += data.size;
      update({ bytes: byteCount });
    };
    recorder.onerror = (event) => {
      recorderError = new Error(`Video encoder failed: ${event.error?.message || 'unknown error'}`);
    };
    recorder.onstop = () => {
      if (recorderError) finishRecorder.reject(recorderError);
      else finishRecorder.resolve();
    };
    // Ensure the recorderFinished promise always has a rejection handler even
    // if recording stops while the source player is still settling.
    recorderFinished.catch(() => {});

    let lastPaint = 0;
    const draw = (now) => {
      if (signal.aborted) return;
      if (now - lastPaint >= 1000 / plan.fps && video.readyState >= 2) {
        lastPaint = now;
        const ratio = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const drawW = video.videoWidth * ratio;
        const drawH = video.videoHeight * ratio;
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        try { context.drawImage(video, (canvas.width - drawW) / 2, (canvas.height - drawH) / 2, drawW, drawH); }
        catch { /* Decoder may not have a drawable frame yet. */ }
      }
      animationId = requestAnimationFrame(draw);
    };

    let lastPosition = 0;
    let lastMovement = Date.now();
    update({ phase: 'encoding', detail: 'Converting video in one pass', fraction: 0 });

    const playbackFinished = new Promise((resolve, reject) => {
      let ended = false;
      const cleanup = () => {
        video.removeEventListener('ended', endedHandler);
        video.removeEventListener('error', errorHandler);
        signal.removeEventListener('abort', abortHandler);
        clearInterval(monitor);
        monitor = null;
      };
      const complete = (error) => {
        if (ended) return;
        ended = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const endedHandler = () => complete();
      const errorHandler = () => complete(new Error('The source video stopped decoding. Try converting a different file format.'));
      const abortHandler = () => complete(cancelledError());
      video.addEventListener('ended', endedHandler);
      video.addEventListener('error', errorHandler);
      signal.addEventListener('abort', abortHandler, { once: true });
      monitor = setInterval(() => {
        if (signal.aborted) return abortHandler();
        const position = video.currentTime;
        if (video.ended || (Number.isFinite(video.duration) && video.duration - position < 0.08 && !video.paused)) {
          complete();
          return;
        }
        if (position > lastPosition + 0.03) {
          lastMovement = Date.now();
          lastPosition = position;
        }
        const stalledFor = Date.now() - lastMovement;
        const remaining = Math.max(0, plan.duration - position);
        update({
          fraction: clamp(position / plan.duration, 0, 1), remaining,
          detail: document.hidden
            ? 'Keep this tab open and the screen awake to continue.'
            : stalledFor > 3500 ? 'Waiting for video decoding…' : 'Encoding video · keep this screen open',
        });
        if (stalledFor > 25_000) {
          complete(new Error('Video processing stopped progressing. Keep the app visible and your phone awake, then retry.'));
        }
      }, 400);
      onEndedCleanup = cleanup;
    });
    // Attach rejection handling before any video playback/encoder startup.
    playbackFinished.catch(() => {});
    recorder.start(900);
    animationId = requestAnimationFrame(draw);
    // MediaRecorder starts before playback so short clips do not lose their
    // first seconds, a race in the previous version of the converter.
    video.muted = false;
    try {
      await bounded(video.play(), 15_000, 'Starting video playback', signal);
    } catch (cause) {
      if (signal.aborted) throw cancelledError();
      if (cause?.name === 'NotAllowedError') throw new Error('Playback was blocked by the browser. Tap Compress directly, keep this tab visible, and try again.');
      throw cause;
    }
    await playbackFinished;
    assertNotCancelled(signal);
    update({ phase: 'finalizing', detail: 'Finalizing the video file…', fraction: 1, remaining: 0 });
    if (recorder.state !== 'inactive') recorder.stop();
    await bounded(recorderFinished, 25_000, 'Finalizing encoded video', signal);
    assertNotCancelled(signal);

    const actualMime = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || mimeType || 'application/octet-stream';
    return { blob: new Blob(chunks, { type: actualMime }), hadAudio: !!audioTrack };
  } finally {
    if (animationId != null) cancelAnimationFrame(animationId);
    onEndedCleanup?.();
    if (monitor != null) clearInterval(monitor);
    try { if (recorder?.state !== 'inactive') recorder.stop(); } catch { /* Already stopped. */ }
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    canvasStream?.getTracks().forEach((track) => track.stop());
    audioDestination?.stream?.getTracks().forEach((track) => track.stop());
    try { await audioContext?.close(); } catch { /* Audio was already closed. */ }
    URL.revokeObjectURL(sourceUrl);
  }
}
