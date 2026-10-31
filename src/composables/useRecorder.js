import { computed, onBeforeUnmount, ref } from 'vue';
import { AUDIO_BPS, STOP_AT_BYTES, LIMIT_BYTES, preferredMime, suggestedVideoBitrate } from '../lib/media.js';

export function useRecorder(settings) {
  const previewEl = ref(null);
  const cameraStream = ref(null);
  const cameras = ref([]);
  const status = ref('idle');
  const error = ref('');
  const hint = ref('');
  const bytes = ref(0);
  const elapsed = ref(0);
  const result = ref(null);
  const resultMime = ref('');
  const hasAudio = ref(false);
  const torchAvailable = ref(false);
  const torchOn = ref(false);
  const zoom = ref(1);
  const zoomRange = ref(null);
  const previewNeedsGesture = ref(false);
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const mime = ref(preferredMime());

  let activeRecorder = null;
  let currentStream = null;
  let currentTrack = null;
  let timer = null;
  let startedAt = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let parts = [];
  let wakeLock = null;
  let stopReason = '';
  let sessionId = 0;
  let discardOnStop = false; // Reset while capturing must not publish an unfinished blob.
  let fallbackEncoder = false;
  let lastActiveTick = 0;

  const recording = computed(() => status.value === 'recording' || status.value === 'paused');
  const videoBps = computed(() => settings.mode === 'custom'
    ? Math.max(160, Number(settings.manualKbps) || 1200) * 1000
    : suggestedVideoBitrate(settings.targetMinutes, settings.microphone));
  const progress = computed(() => Math.min(100, (bytes.value / LIMIT_BYTES) * 100));

  function updateTime() {
    if (!startedAt) return;
    const currentPause = pausedAt ? Date.now() - pausedAt : 0;
    elapsed.value = Math.max(0, (Date.now() - startedAt - pausedTotal - currentPause) / 1000);
    // Safari may defer ondataavailable until stop or while the screen sleeps.
    // Also enforce an estimated cutoff if the encoder has not emitted chunks,
    // but never confuse this estimate with actual output bytes.
    if (status.value === 'recording' && elapsed.value - lastActiveTick > 0.4) {
      lastActiveTick = elapsed.value;
      const estimate = (elapsed.value * (videoBps.value + (hasAudio.value ? AUDIO_BPS : 0))) / 8;
      if (estimate >= STOP_AT_BYTES && bytes.value < STOP_AT_BYTES) {
        stopRecording('Stopped at the estimated 46 MB limit; verify the actual final size before uploading.');
      }
    }
  }

  async function listCameras() {
    try {
      cameras.value = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === 'videoinput');
    } catch { cameras.value = []; }
  }

  function shutCamera() {
    if (recording.value || status.value === 'finalizing') return;
    ++sessionId;
    currentStream?.getTracks().forEach((track) => track.stop());
    currentStream = null;
    currentTrack = null;
    cameraStream.value = null;
    if (previewEl.value) previewEl.value.srcObject = null;
    torchAvailable.value = false;
    torchOn.value = false;
    zoomRange.value = null;
    previewNeedsGesture.value = false;
    status.value = 'idle';
  }

  async function enableCamera() {
    if (recording.value || status.value === 'finalizing' || status.value === 'loading') return;
    error.value = '';
    hint.value = '';
    if (!supported) { error.value = 'This browser does not support camera recording with MediaRecorder.'; return; }
    if (!secure) { error.value = 'Camera access requires HTTPS (or localhost). Open the app using a secure URL.'; return; }

    shutCamera();
    // shutCamera advances the token so older getUserMedia promises cannot replace this stream.
    const activeRequestId = sessionId;
    status.value = 'loading';
    const [width, height] = settings.resolution.split('x').map(Number);
    const video = {
      width: { ideal: width }, height: { ideal: height },
      frameRate: { ideal: Number(settings.fps) },
      ...(settings.cameraId ? { deviceId: { ideal: settings.cameraId } } : { facingMode: { ideal: 'environment' } }),
    };

    try {
      let opened;
      try {
        opened = await navigator.mediaDevices.getUserMedia({ video, audio: settings.microphone });
      } catch (firstError) {
        if (!settings.microphone) throw firstError;
        // A mic denial need not prevent video-only recording.
        opened = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        hint.value = 'Microphone unavailable; video-only recording is enabled.';
      }
      if (sessionId !== activeRequestId) { opened.getTracks().forEach((t) => t.stop()); return; }
      currentStream = opened;
      cameraStream.value = opened;
      currentTrack = opened.getVideoTracks()[0] || null;
      hasAudio.value = opened.getAudioTracks().length > 0;
      if (previewEl.value) {
        // iPhone Safari requires inline, muted playback for a custom overlay.
        previewEl.value.muted = true;
        previewEl.value.playsInline = true;
        previewEl.value.setAttribute('playsinline', '');
        previewEl.value.setAttribute('webkit-playsinline', '');
        previewEl.value.srcObject = opened;
        await previewEl.value.play().catch(() => {
          previewNeedsGesture.value = true;
          hint.value = 'iOS requires another tap to start the camera preview.';
        });
      }
      if (currentTrack) {
        currentTrack.onended = () => { if (recording.value) stopRecording('Camera disconnected.'); else shutCamera(); };
        const capabilities = currentTrack.getCapabilities?.() || {};
        torchAvailable.value = !!capabilities.torch;
        if (capabilities.zoom && Number.isFinite(capabilities.zoom.min)) {
          zoomRange.value = capabilities.zoom;
          zoom.value = currentTrack.getSettings?.().zoom || capabilities.zoom.min;
        }
      }
      status.value = 'ready';
      await listCameras();
      const activeId = currentTrack?.getSettings?.().deviceId;
      if (activeId) settings.cameraId = activeId;
    } catch (cause) {
      // A previous request may reject after the user has reopened or turned OFF
      // the camera. Do not overwrite a newer request's stream/status or error.
      if (sessionId !== activeRequestId) return;
      status.value = 'idle';
      error.value = `Could not open camera: ${cause?.message || 'Permission denied or camera unavailable.'}`;
    }
  }

  async function resumePreview() {
    if (!previewEl.value || !currentStream) return;
    try {
      await previewEl.value.play();
      previewNeedsGesture.value = false;
      if (hint.value.includes('camera preview') || hint.value.includes('another tap')) hint.value = '';
    } catch (cause) {
      previewNeedsGesture.value = true;
      hint.value = `Camera preview could not resume: ${cause?.message || 'Try reopening the camera.'}`;
    }
  }

  async function toggleTorch() {
    if (!currentTrack || !torchAvailable.value) return;
    try {
      await currentTrack.applyConstraints({ advanced: [{ torch: !torchOn.value }] });
      torchOn.value = !torchOn.value;
    } catch { hint.value = 'Torch is not supported by the current camera mode.'; }
  }

  async function setZoom(value) {
    if (!currentTrack || !zoomRange.value) return;
    const next = Number(value);
    try {
      await currentTrack.applyConstraints({ advanced: [{ zoom: next }] });
      zoom.value = next;
    } catch { hint.value = 'Camera zoom adjustment failed.'; }
  }

  async function acquireWakeLock() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Optional on mobile. */ }
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch { /* It may already have been released. */ }
    wakeLock = null;
  }

  function startRecording() {
    if (!currentStream?.active || status.value !== 'ready') return;
    error.value = '';
    hint.value = '';
    parts = [];
    bytes.value = 0;
    elapsed.value = 0;
    pausedTotal = 0;
    pausedAt = 0;
    stopReason = '';
    discardOnStop = false;
    fallbackEncoder = false;
    lastActiveTick = 0;
    result.value = null;
    resultMime.value = '';
    const opts = { videoBitsPerSecond: videoBps.value };
    const selectedMime = preferredMime();
    if (selectedMime) opts.mimeType = selectedMime;
    if (hasAudio.value) opts.audioBitsPerSecond = AUDIO_BPS;

    try {
      activeRecorder = new MediaRecorder(currentStream, opts);
    } catch (cause) {
      // Some Safari builds are more reliable choosing their own native MP4
      // encoder even if isTypeSupported() reported an explicit codec string.
      try {
        fallbackEncoder = true;
        activeRecorder = new MediaRecorder(currentStream, {
          videoBitsPerSecond: videoBps.value,
          ...(hasAudio.value ? { audioBitsPerSecond: AUDIO_BPS } : {}),
        });
      } catch (fallbackCause) {
        error.value = `Cannot start recording: ${fallbackCause?.message || cause?.message || 'Encoder unavailable'}`;
        return;
      }
    }
    const recorder = activeRecorder;
    mime.value = recorder.mimeType || selectedMime;
    recorder.ondataavailable = ({ data }) => {
      if (!data?.size || discardOnStop) return;
      parts.push(data);
      bytes.value += data.size;
      // Real-time encoding: ondataavailable contains already-compressed chunks.
      // Stop early; the delayed final chunk can be larger than a timeslice.
      if (bytes.value >= STOP_AT_BYTES && recorder.state !== 'inactive') stopRecording('Stopped near 50 MB size limit.');
    };
    recorder.onerror = (event) => {
      error.value = `Recording failed: ${event.error?.message || 'Encoder error'}`;
      stopRecording('Recording encountered an error.');
    };
    recorder.onstop = async () => {
      clearInterval(timer);
      timer = null;
      updateTime();
      if (pausedAt) { pausedTotal += Date.now() - pausedAt; pausedAt = 0; }
      // On Safari, MediaRecorder.mimeType may be empty. Prefer chunk.type
      // over assuming WebM; a wrong MIME breaks iOS Photos/Share handling.
      const actualMime = recorder.mimeType || parts.find((part) => part.type)?.type || (!fallbackEncoder ? selectedMime : '') || 'application/octet-stream';
      const blob = new Blob(parts, { type: actualMime });
      activeRecorder = null;
      status.value = currentStream?.active ? 'ready' : 'idle';
      if (discardOnStop) {
        // Reset during pause/recording waits for stop, then forgets ALL chunks.
        discardOnStop = false;
        parts = [];
        bytes.value = 0;
        elapsed.value = 0;
        result.value = null;
        resultMime.value = '';
        hint.value = 'Take discarded. Camera is ready for a new recording.';
        error.value = '';
        stopReason = '';
        await releaseWakeLock();
        return;
      }
      bytes.value = blob.size;
      result.value = blob.size ? blob : null;
      resultMime.value = blob.type;
      parts = []; // Avoid retaining every chunk in addition to the final blob.
      if (blob.size > LIMIT_BYTES) {
        hint.value = 'Recording exceeded 50 MB despite the safety buffer. Use Compress file below before uploading.';
      } else if (stopReason) {
        hint.value = stopReason;
      }
      await releaseWakeLock();
    };

    try {
      // A timeslice provides size readings during capture. It is a request, not
      // a reliable exact interval on all mobile browsers.
      recorder.start(750);
      startedAt = Date.now();
      status.value = 'recording';
      timer = setInterval(updateTime, 200);
      acquireWakeLock();
    } catch (cause) {
      activeRecorder = null;
      parts = [];
      error.value = `Recorder could not start: ${cause.message}`;
    }
  }

  function stopRecording(reason = '') {
    const recorder = activeRecorder;
    if (!recorder || recorder.state === 'inactive') return;
    if (reason) stopReason = reason;
    try { recorder.stop(); status.value = 'finalizing'; } catch { /* Another event may have stopped it. */ }
  }

  function togglePause() {
    if (!activeRecorder) return;
    try {
      if (activeRecorder.state === 'recording') {
        activeRecorder.pause();
        pausedAt = Date.now();
        status.value = 'paused';
      } else if (activeRecorder.state === 'paused') {
        activeRecorder.resume();
        pausedTotal += Date.now() - pausedAt;
        pausedAt = 0;
        status.value = 'recording';
      }
    } catch (cause) {
      hint.value = `Pause/resume not supported by this encoder: ${cause?.message || 'unknown error'}`;
    }
  }

  function resetTake() {
    if (status.value === 'finalizing') {
      // A pending reset must survive until Safari has emitted its final chunk.
      discardOnStop = true;
      return;
    }
    if (recording.value) {
      discardOnStop = true;
      stopRecording();
      return;
    }
    result.value = null;
    resultMime.value = '';
    bytes.value = 0;
    elapsed.value = 0;
    startedAt = 0;
    pausedAt = 0;
    pausedTotal = 0;
    parts = [];
    hint.value = '';
    error.value = '';
  }

  // Keep compatibility with the existing ResultCard's discard event.
  function discardResult() { resetTake(); }

  // iOS/WebKit can pause or end camera access after app switching or screen
  // locking. Do not silently claim background recording is supported.
  function onVisibilityChange() {
    if (document.hidden && recording.value) {
      hint.value = 'Keep this app open and the phone awake while recording; iOS and Android may pause video in the background.';
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);

  // Do not intentionally stop an ongoing capture when the user changes a UI tab.
  // Cleanup only when the application actually unmounts.
  onBeforeUnmount(() => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
    if (activeRecorder?.state !== 'inactive') { try { activeRecorder?.stop(); } catch { /* Ignore. */ } }
    clearInterval(timer);
    currentStream?.getTracks().forEach((track) => track.stop());
    releaseWakeLock();
  });

  return {
    previewEl, cameraStream, cameras, status, error, hint, bytes, elapsed, result,
    resultMime, hasAudio, torchAvailable, torchOn, zoom, zoomRange, supported, secure,
    mime, recording, progress, videoBps, previewNeedsGesture, enableCamera, resumePreview, shutCamera, listCameras,
    toggleTorch, setZoom, startRecording, stopRecording, togglePause, resetTake, discardResult,
  };
}
