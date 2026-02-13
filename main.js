// main.js
/********************************************************************
 * 50MB Video Recorder/Converter (MP4-first)
 * - No FFmpeg. Uses canvas re-encode via MediaRecorder.
 * - MP4 output is ONLY possible if the browser can encode MP4.
 ********************************************************************/

// GorillaDesk limit
const MAX_BYTES = 50 * 1024 * 1024;
const SAFETY_BYTES = 512 * 1024; // keep a little buffer under 50MB

const $ = (id) => document.getElementById(id);

// UI refs
const limitLabel = $("limitLabel");
const secureBanner = $("secureBanner");
const mp4Banner = $("mp4Banner");

const tabRecord = $("tabRecord");
const tabUpload = $("tabUpload");
const recordPanel = $("recordPanel");
const uploadPanel = $("uploadPanel");

const preview = $("preview");
const enableCameraBtn = $("enableCameraBtn");
const restartPreviewBtn = $("restartPreviewBtn");

const recordToggleBtn = $("recordToggleBtn");
const pauseBtn = $("pauseBtn");
const resetBtn = $("resetBtn");

const fileInput = $("fileInput");

const convertBtn = $("convertBtn");
const cancelConvertBtn = $("cancelConvertBtn");

const recSizeLabel = $("recSizeLabel");
const recTimeLabel = $("recTimeLabel");
const recBarFill = $("recBarFill");

const preferredMimeLabel = $("preferredMimeLabel");
const gdCompatLabel = $("gdCompatLabel");

const progressBox = $("progressBox");
const attemptText = $("attemptText");
const progressText = $("progressText");
const progressLog = $("progressLog");

const resultArea = $("resultArea");

// Settings
const settingsBtn = $("settingsBtn");
const themeBtn = $("themeBtn");
const sheetOverlay = $("sheetOverlay");
const sheet = $("sheet");
const closeSheetBtn = $("closeSheetBtn");

const cameraSelect = $("cameraSelect");
const fpsSelect = $("fpsSelect");

const previewResSelect = $("previewResSelect");
const convertResSelect = $("convertResSelect");
const recordBitrate = $("recordBitrate");
const recordBitrateLabel = $("recordBitrateLabel");
const minQualitySelect = $("minQualitySelect");

const torchBtn = $("torchBtn");
const zoomRange = $("zoomRange");
const zoomValue = $("zoomValue");

const torchLabel = $("torchLabel");
const zoomLabel = $("zoomLabel");

// Small status labels
const cameraStateLabel = $("cameraStateLabel");
const recStateLabel = $("recStateLabel");
const convertStateLabel = $("convertStateLabel");

// Modal preview
const modalOverlay = $("modalOverlay");
const videoModal = $("videoModal");
const closeModalBtn = $("closeModalBtn");
const modalVideo = $("modalVideo");
const modalMetaNote = $("modalMetaNote");

// Hidden tools for conversion
const xCanvas = $("xCanvas");
const xVideo = $("xVideo");

/********************************************************************
 * Local Storage (remember settings)
 ********************************************************************/
const LS_KEYS = {
  THEME: "vd_theme",
  MODE: "vd_mode", // record | upload
  FPS: "vd_fps", // default 30
  PREVIEW_RES: "vd_preview_res",
  CONVERT_RES: "vd_convert_res",
  BITRATE_KBPS: "vd_bitrate_kbps",
  MIN_QUALITY: "vd_min_quality",
  CAMERA_ID: "vd_camera_id",
  AUTO_ENABLE_CAMERA: "vd_auto_enable_camera",
  TORCH_ON: "vd_torch_on",
  ZOOM: "vd_zoom",
};

function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (_) {}
}
function lsGetNum(key, fallback) {
  const v = Number(lsGet(key, ""));
  return Number.isFinite(v) ? v : fallback;
}
function lsGetBool(key, fallback) {
  const v = lsGet(key, "");
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/********************************************************************
 * Theme
 ********************************************************************/
const THEME_KEY = LS_KEYS.THEME;
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}
applyTheme(localStorage.getItem(THEME_KEY) || "dark");
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
});

/********************************************************************
 * State
 ********************************************************************/
let mode = "record";

let stream = null;
let videoTrack = null;

let mediaRecorder = null;
let chunks = [];
let recordedBytes = 0;
let startTs = 0;
let tickTimer = null;

let torchOn = false;

// Source blob (recorded or uploaded)
let sourceBlob = null;
let sourceLabel = "";

// Cancel conversion
let cancelRequested = false;

// Preferred output mime (MP4-first)
let preferredOutputMime = "";

// Latest result for preview modal + save/share
let lastResultBlob = null;
let lastResultLabel = "";
let lastResultUrl = "";

/********************************************************************
 * Helpers
 ********************************************************************/
function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function fmtTime(sec) {
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
function isSecureEnoughForCamera() {
  // file:// on iPhone is not secure; https is.
  return window.isSecureContext === true;
}
function safeIsTypeSupported(mime) {
  try {
    return !!(
      window.MediaRecorder &&
      MediaRecorder.isTypeSupported &&
      MediaRecorder.isTypeSupported(mime)
    );
  } catch (_) {
    return false;
  }
}
function pickPreferredOutputMime() {
  const mp4Candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401E,mp4a.40.2",
    "video/mp4",
  ];
  for (const t of mp4Candidates) if (safeIsTypeSupported(t)) return t;

  const webmCandidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const t of webmCandidates) if (safeIsTypeSupported(t)) return t;

  return "";
}
function isGorillaDeskCompatibleMime(mime) {
  const m = (mime || "").toLowerCase();
  return m.includes("video/mp4") || m.includes("video/quicktime");
}
function guessExtensionForMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("video/mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("video/webm")) return "webm";
  return "mp4";
}

/********************************************************************
 * UI updates
 ********************************************************************/
function updateOutputBadges() {
  const shown = preferredOutputMime || "(browser default)";
  preferredMimeLabel.textContent = shown;

  const compat = isGorillaDeskCompatibleMime(preferredOutputMime);
  gdCompatLabel.textContent = compat ? "YES" : "NO";
  gdCompatLabel.className = "mono " + (compat ? "ok" : "warn");

  const mp4Supported =
    safeIsTypeSupported("video/mp4") ||
    safeIsTypeSupported("video/mp4;codecs=avc1.42E01E,mp4a.40.2") ||
    safeIsTypeSupported("video/mp4;codecs=avc1.4D401E,mp4a.40.2");

  mp4Banner.style.display = mp4Supported ? "none" : "block";
}

function setMode(next) {
  mode = next;
  lsSet(LS_KEYS.MODE, mode);

  if (mode === "record") {
    tabRecord.classList.add("active");
    tabUpload.classList.remove("active");
    tabRecord.setAttribute("aria-selected", "true");
    tabUpload.setAttribute("aria-selected", "false");
    recordPanel.style.display = "";
    uploadPanel.style.display = "none";
  } else {
    tabUpload.classList.add("active");
    tabRecord.classList.remove("active");
    tabUpload.setAttribute("aria-selected", "true");
    tabRecord.setAttribute("aria-selected", "false");
    uploadPanel.style.display = "";
    recordPanel.style.display = "none";
  }

  updateConvertButtonState();
}

function updateConvertButtonState() {
  convertBtn.disabled =
    !sourceBlob ||
    (mediaRecorder && mediaRecorder.state !== "inactive") ||
    cancelRequested;

  convertStateLabel.textContent = convertBtn.disabled ? "Waiting…" : "Ready";
}

function showProgress(show) {
  progressBox.style.display = show ? "block" : "none";
  if (!show) {
    attemptText.textContent = "—";
    progressText.textContent = "—";
    progressLog.textContent = "";
  }
}

function logProgress(line) {
  progressLog.textContent = (progressLog.textContent + "\n" + line).trim();
  progressLog.scrollTop = progressLog.scrollHeight;
}

function updateRecUI() {
  recSizeLabel.textContent = fmtMB(recordedBytes);

  const secs = startTs
    ? Math.max(0, Math.floor((Date.now() - startTs) / 1000))
    : 0;
  recTimeLabel.textContent = fmtTime(secs);

  const pct = Math.min(100, (recordedBytes / MAX_BYTES) * 100);
  recBarFill.style.width = pct.toFixed(1) + "%";

  torchLabel.textContent = torchBtn.disabled ? "n/a" : torchOn ? "On" : "Off";
  zoomLabel.textContent = zoomRange.disabled
    ? "n/a"
    : Number(zoomRange.value).toFixed(1) + "x";
}

function clearResult() {
  // clear last preview url safely
  if (lastResultUrl) {
    try {
      URL.revokeObjectURL(lastResultUrl);
    } catch (_) {}
  }
  lastResultUrl = "";
  lastResultBlob = null;
  lastResultLabel = "";

  resultArea.innerHTML = `<div class="note">Converted output will appear here with Save/Share.</div>`;
}

function openPreviewModal(blob, label) {
  if (!blob) return;

  // remove hidden + inert
  modalOverlay.hidden = false;
  videoModal.hidden = false;
  videoModal.removeAttribute("inert");

  // set video source
  const url = URL.createObjectURL(blob);
  modalVideo.src = url;
  videoModal.dataset.tempUrl = url;

  const ext = guessExtensionForMime(blob.type || preferredOutputMime || "");
  modalMetaNote.textContent = `${label || "Video"} • ${fmtMB(blob.size)} • ${blob.type || "video/*"} • .${ext}`;

  // focus close button for accessibility
  closeModalBtn.focus();

  setTimeout(() => {
    try {
      modalVideo.play();
    } catch (_) {}
  }, 0);
}
function closePreviewModal() {
  // blur anything focused inside modal FIRST
  if (videoModal.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  // stop playback
  try {
    modalVideo.pause();
  } catch (_) {}

  // revoke object URL
  const tempUrl = videoModal.dataset.tempUrl || "";
  if (tempUrl) {
    try {
      URL.revokeObjectURL(tempUrl);
    } catch (_) {}
  }
  videoModal.dataset.tempUrl = "";

  // hide safely
  videoModal.setAttribute("inert", "");
  videoModal.hidden = true;
  modalOverlay.hidden = true;
}

// closeModalBtn.addEventListener("click", closePreviewModal);
// modalOverlay.addEventListener("click", closePreviewModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePreviewModal();
    closeSheet();
  }
});

/********************************************************************
 * Render result (Save + Preview + Share grouped)
 ********************************************************************/
function renderResult(blob, label) {
  // keep last result for modal preview button too
  lastResultBlob = blob;
  lastResultLabel = label || "Output";

  const url = URL.createObjectURL(blob);
  lastResultUrl = url;

  const ext = guessExtensionForMime(blob.type || preferredOutputMime || "");
  const okSize = blob.size <= MAX_BYTES - SAFETY_BYTES;
  const gdOk = isGorillaDeskCompatibleMime(blob.type || "");

  resultArea.innerHTML = `
      <div class="pill" style="width:100%; justify-content:space-between; margin-bottom:10px;">
        <span>${label || "Output"}: <span class="mono ${
          okSize ? "ok" : "warn"
        }">${fmtMB(blob.size)}</span></span>
        <span class="mono">${blob.type || "video/*"}</span>
      </div>

      <div class="pill" style="width:100%; justify-content:space-between; margin-bottom:10px;">
        <span>GorillaDesk compatible:</span>
        <span class="mono ${gdOk ? "ok" : "warn"}">${
          gdOk ? "YES" : "NO (WebM not accepted)"
        }</span>
      </div>

      <div class="actions tight">
        <a class="btn primary" href="${url}" download="gorilladesk-video.${ext}">⬇️ Save</a>
        <button class="btn" id="previewBtn" type="button">🎬 Preview</button>
        <button class="btn" id="shareBtn" type="button">📤 Share</button>
      </div>

      ${
        gdOk
          ? ""
          : `<div class="note warn">
        This output is WebM. GorillaDesk won’t accept it. Use iPhone Safari over HTTPS (often supports MP4) or use FFmpeg/server conversion.
      </div>`
      }
    `;

  const previewBtn = document.getElementById("previewBtn");
  previewBtn.addEventListener("click", () => openPreviewModal(blob, label));

  const shareBtn = document.getElementById("shareBtn");
  shareBtn.addEventListener("click", async () => {
    try {
      const file = new File([blob], `gorilladesk-video.${ext}`, {
        type: blob.type || "video/*",
      });
      if (
        navigator.canShare &&
        navigator.canShare({ files: [file] }) &&
        navigator.share
      ) {
        await navigator.share({
          files: [file],
          title: "Video",
          text: "Compressed video (≤ 50MB)",
        });
      } else {
        alert("Share is not supported here. Use Save instead.");
      }
    } catch (err) {
      console.error(err);
      alert("Share failed on this device/browser. Use Save instead.");
    }
  });
}

/********************************************************************
 * Settings sheet (fixed bounds)
 ********************************************************************/
function openSheet() {
  sheetOverlay.style.display = "block";
  sheet.style.transform = "translateY(0)";
  sheet.setAttribute("aria-hidden", "false");

  // Prevent background scroll on iOS
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  sheetOverlay.style.display = "none";
  sheet.style.transform = "translateY(110%)";
  sheet.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";
}
settingsBtn.addEventListener("click", openSheet);
closeSheetBtn.addEventListener("click", closeSheet);
sheetOverlay.addEventListener("click", closeSheet);

/********************************************************************
 * Camera controls
 ********************************************************************/
function getCapsSafe(track) {
  try {
    return track?.getCapabilities ? track.getCapabilities() : {};
  } catch (_) {
    return {};
  }
}

async function applyTorch(on) {
  if (!videoTrack) return;
  try {
    await videoTrack.applyConstraints({ advanced: [{ torch: !!on }] });
    torchOn = !!on;
    lsSet(LS_KEYS.TORCH_ON, torchOn);
    torchBtn.textContent = torchOn ? "🔦 Torch: On" : "🔦 Torch: Off";
    updateRecUI();
  } catch (e) {
    console.error(e);
    alert("Torch failed on this device/camera.");
  }
}

async function applyZoom(z) {
  if (!videoTrack) return;
  try {
    await videoTrack.applyConstraints({ advanced: [{ zoom: Number(z) }] });
    lsSet(LS_KEYS.ZOOM, Number(z));
    zoomValue.textContent = Number(z).toFixed(1) + "x";
    updateRecUI();
  } catch (e) {
    // ignore while sliding
  }
}

function setupTorchZoomUI() {
  torchOn = false;
  torchBtn.disabled = true;
  torchBtn.textContent = "🔦 Torch: n/a";

  zoomRange.disabled = true;
  zoomValue.textContent = "n/a";

  if (!videoTrack) {
    updateRecUI();
    return;
  }

  const caps = getCapsSafe(videoTrack);

  if (caps.torch) {
    torchBtn.disabled = false;
    torchBtn.textContent = "🔦 Torch: Off";
  }

  if (
    caps.zoom &&
    typeof caps.zoom.min === "number" &&
    typeof caps.zoom.max === "number"
  ) {
    zoomRange.disabled = false;
    zoomRange.min = caps.zoom.min;
    zoomRange.max = caps.zoom.max;
    zoomRange.step = caps.zoom.step || 0.1;

    const settings = (videoTrack.getSettings && videoTrack.getSettings()) || {};
    const zFromTrack =
      typeof settings.zoom === "number" ? settings.zoom : caps.zoom.min;

    const zSaved = lsGetNum(LS_KEYS.ZOOM, zFromTrack);
    const zClamped = Math.min(caps.zoom.max, Math.max(caps.zoom.min, zSaved));

    zoomRange.value = zClamped;
    zoomValue.textContent = Number(zClamped).toFixed(1) + "x";
  }

  updateRecUI();
}

torchBtn.addEventListener("click", () => applyTorch(!torchOn));
zoomRange.addEventListener("input", (e) => applyZoom(e.target.value));

/********************************************************************
 * Camera setup
 ********************************************************************/
function stopStream() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  videoTrack = null;

  cameraStateLabel.textContent = "Not enabled";
}

async function getDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

function pickBestBackCameraId(cams) {
  if (!Array.isArray(cams) || cams.length === 0) return "";

  const savedId = lsGet(LS_KEYS.CAMERA_ID, "");
  if (savedId && cams.some((c) => c.deviceId === savedId)) return savedId;

  const byLabel = cams.find((c) =>
    /back|rear|environment/i.test(c.label || ""),
  );
  if (byLabel) return byLabel.deviceId;

  const notFront = cams.find((c) => !/front|user/i.test(c.label || ""));
  if (notFront) return notFront.deviceId;

  return cams[0].deviceId;
}

async function populateCameras() {
  cameraSelect.innerHTML = "";
  const cams = await getDevices();

  cams.forEach((cam, idx) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Camera ${idx + 1}`;
    cameraSelect.appendChild(opt);
  });

  const bestId = pickBestBackCameraId(cams);
  if (bestId) cameraSelect.value = bestId;

  if (cameraSelect.value) lsSet(LS_KEYS.CAMERA_ID, cameraSelect.value);
}

async function startPreview() {
  stopStream();
  torchOn = false;

  const [w, h] = previewResSelect.value.split("x").map(Number);
  const fps = Number(fpsSelect.value) || 30;

  const selectedId = cameraSelect.value || "";
  const savedId = lsGet(LS_KEYS.CAMERA_ID, "");
  const deviceIdToUse = selectedId || savedId || "";

  const constraints = {
    audio: true,
    video: {
      deviceId: deviceIdToUse ? { ideal: deviceIdToUse } : undefined,
      facingMode: deviceIdToUse ? undefined : { ideal: "environment" },
      width: { ideal: w },
      height: { ideal: h },
      frameRate: { ideal: fps },
    },
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  preview.srcObject = stream;

  try {
    await preview.play();
  } catch (_) {}

  videoTrack = stream.getVideoTracks()[0] || null;
  setupTorchZoomUI();

  cameraStateLabel.textContent = "Enabled";
  recordToggleBtn.disabled = false;
  pauseBtn.disabled = true;

  // Sync cameraSelect with actual deviceId if present
  try {
    const settings =
      (videoTrack && videoTrack.getSettings && videoTrack.getSettings()) || {};
    if (settings.deviceId && cameraSelect) {
      const has = Array.from(cameraSelect.options).some(
        (o) => o.value === settings.deviceId,
      );
      if (has) {
        cameraSelect.value = settings.deviceId;
        lsSet(LS_KEYS.CAMERA_ID, settings.deviceId);
      }
    }
  } catch (_) {}

  // Restore torch (best-effort)
  const torchWanted = lsGetBool(LS_KEYS.TORCH_ON, false);
  if (torchWanted && !torchBtn.disabled) {
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: true }] });
      torchOn = true;
      torchBtn.textContent = "🔦 Torch: On";
    } catch (_) {}
  }

  // Restore zoom (best-effort)
  if (!zoomRange.disabled) {
    const z = lsGetNum(LS_KEYS.ZOOM, Number(zoomRange.value));
    try {
      await applyZoom(z);
      zoomRange.value = z;
    } catch (_) {}
  }

  updateRecUI();
}

cameraSelect.addEventListener("change", async () => {
  lsSet(LS_KEYS.CAMERA_ID, cameraSelect.value || "");
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  try {
    await startPreview();
  } catch (e) {
    console.error(e);
  }
});

previewResSelect.addEventListener("change", async () => {
  lsSet(LS_KEYS.PREVIEW_RES, previewResSelect.value);
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  try {
    await startPreview();
  } catch (e) {
    console.error(e);
  }
});

fpsSelect.addEventListener("change", async () => {
  lsSet(LS_KEYS.FPS, fpsSelect.value);
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  try {
    await startPreview();
  } catch (e) {
    console.error(e);
  }
});

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    if (!lsGetBool(LS_KEYS.AUTO_ENABLE_CAMERA, false)) return;
    try {
      await populateCameras();
    } catch (_) {}
  });
}

/********************************************************************
 * Recording (start/stop toggle + pause)
 ********************************************************************/
function resetRecordingState() {
  chunks = [];
  recordedBytes = 0;
  startTs = 0;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;

  recStateLabel.textContent = "Idle";
  updateRecUI();
}

function bestRecorderMimeForCurrentDevice() {
  const mime = preferredOutputMime || pickPreferredOutputMime();
  return mime || "";
}

function isRecordingActive() {
  return mediaRecorder && mediaRecorder.state === "recording";
}
function isRecordingPaused() {
  return mediaRecorder && mediaRecorder.state === "paused";
}

async function startRecording() {
  if (!stream) {
    alert("Tap Enable Camera first.");
    return;
  }

  cancelRequested = false;
  cancelConvertBtn.disabled = true;

  resetRecordingState();
  clearResult();

  const mimeType = bestRecorderMimeForCurrentDevice();
  const options = {};
  if (mimeType) options.mimeType = mimeType;
  options.videoBitsPerSecond = Number(recordBitrate.value) * 1000;

  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    console.error(e);
    alert("Recording failed to start on this browser/device.");
    return;
  }

  const TIMESLICE_MS = 1000;

  mediaRecorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    chunks.push(ev.data);
    recordedBytes += ev.data.size;
    updateRecUI();
  };

  mediaRecorder.onstop = () => {
    recordToggleBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = false;

    recordToggleBtn.classList.remove("danger");
    recordToggleBtn.classList.add("primary");
    recordToggleBtn.textContent = "⏺️ Record";

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;

    recStateLabel.textContent = "Stopped";

    const type = mediaRecorder.mimeType || mimeType || "video/webm";
    const blob = new Blob(chunks, { type });

    sourceBlob = blob;
    sourceLabel = "Recorded";
    updateConvertButtonState();

    // show raw as result (lets user preview/save/share immediately if they want)
    renderResult(blob, "Raw (recorded)");
  };

  mediaRecorder.onpause = () => {
    recStateLabel.textContent = "Paused";
    pauseBtn.textContent = "▶️ Resume";
  };

  mediaRecorder.onresume = () => {
    recStateLabel.textContent = "Recording";
    pauseBtn.textContent = "⏸️ Pause";
  };

  mediaRecorder.start(TIMESLICE_MS);
  startTs = Date.now();

  recStateLabel.textContent = "Recording";

  recordToggleBtn.disabled = false;
  recordToggleBtn.classList.remove("primary");
  recordToggleBtn.classList.add("danger");
  recordToggleBtn.textContent = "⏹️ Stop";

  pauseBtn.disabled = false;
  pauseBtn.textContent = "⏸️ Pause";

  resetBtn.disabled = true;

  tickTimer = setInterval(updateRecUI, 400);
  updateRecUI();
}

function stopRecording() {
  if (!mediaRecorder) return;
  try {
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch (e) {
    console.error(e);
  }
}

function toggleRecord() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    startRecording();
    return;
  }
  // if recording or paused => stop
  stopRecording();
}

function togglePause() {
  if (!mediaRecorder) return;
  try {
    if (mediaRecorder.state === "recording") {
      mediaRecorder.pause();
      return;
    }
    if (mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      return;
    }
  } catch (e) {
    console.error(e);
  }
}

recordToggleBtn.addEventListener("click", toggleRecord);
pauseBtn.addEventListener("click", togglePause);

/********************************************************************
 * Upload
 ********************************************************************/
fileInput.addEventListener("change", async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) {
    sourceBlob = null;
    updateConvertButtonState();
    return;
  }

  sourceBlob = f;
  sourceLabel = "Uploaded";
  cancelRequested = false;
  cancelConvertBtn.disabled = true;

  updateConvertButtonState();
  clearResult();

  // for uploads, show it as “raw” result + allow modal preview too
  renderResult(f, "Raw (uploaded)");
});

/********************************************************************
 * Conversion pipeline (canvas -> MediaRecorder)
 ********************************************************************/
async function getVideoMeta(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => {
      const meta = {
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
      };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: 0, width: 0, height: 0 });
    };
    v.src = url;
  });
}

function parseWH(str) {
  const [w, h] = str.split("x").map(Number);
  return { w, h };
}

function computeBitratesForTarget(durationSec, targetBytes) {
  const audioBps = 64_000;
  const totalBps = Math.max(
    120_000,
    Math.floor((targetBytes * 8) / Math.max(1, durationSec)),
  );
  const videoBps = Math.max(80_000, totalBps - audioBps);
  return { videoBps, audioBps };
}

function scaleDownTier(curW, curH) {
  const tiers = [
    { w: 1280, h: 720 },
    { w: 854, h: 480 },
    { w: 640, h: 360 },
    { w: 426, h: 240 },
    { w: 320, h: 180 },
  ];
  const area = curW * curH;
  const sorted = tiers.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  const idx = sorted.findIndex((t) => t.w === curW && t.h === curH);
  if (idx >= 0 && idx < sorted.length - 1) return sorted[idx + 1];
  return sorted.find((t) => t.w * t.h < area) || sorted[sorted.length - 1];
}

async function transcodeViaCanvas(
  inputBlob,
  outW,
  outH,
  fps,
  videoBps,
  audioBps,
) {
  if (cancelRequested) throw new Error("cancelled");

  const inputUrl = URL.createObjectURL(inputBlob);
  xVideo.src = inputUrl;
  xVideo.muted = false;
  xVideo.playsInline = true;
  xVideo.preload = "auto";

  await new Promise((resolve, reject) => {
    xVideo.onloadedmetadata = () => resolve();
    xVideo.onerror = () =>
      reject(new Error("Failed to load video for conversion"));
  });

  xCanvas.width = outW;
  xCanvas.height = outH;
  const ctx = xCanvas.getContext("2d", { alpha: false });

  const canvasStream = xCanvas.captureStream(fps);

  // Best-effort audio capture
  let mixedStream = canvasStream;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const srcNode = ac.createMediaElementSource(xVideo);
    const dest = ac.createMediaStreamDestination();
    srcNode.connect(dest);
    srcNode.connect(ac.destination);
    const audioTrack = dest.stream.getAudioTracks()[0] || null;

    if (audioTrack) {
      mixedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        audioTrack,
      ]);
    }
  } catch (_) {}

  const outMime = bestRecorderMimeForCurrentDevice();
  const options = {};
  if (outMime) options.mimeType = outMime;
  options.videoBitsPerSecond = Math.floor(videoBps);
  options.audioBitsPerSecond = Math.floor(audioBps);

  let recorder;
  try {
    recorder = new MediaRecorder(mixedStream, options);
  } catch (e) {
    URL.revokeObjectURL(inputUrl);
    throw new Error(
      "MediaRecorder cannot encode with these settings on this device/browser.",
    );
  }

  const outChunks = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) outChunks.push(ev.data);
  };

  // Draw loop
  let rafId = 0;
  let lastFrameTs = 0;
  const frameInterval = 1000 / fps;

  function drawFrame(ts) {
    if (cancelRequested) {
      try {
        recorder.stop();
      } catch (_) {}
      return;
    }

    if (!lastFrameTs || ts - lastFrameTs >= frameInterval) {
      lastFrameTs = ts;

      const vw = xVideo.videoWidth || outW;
      const vh = xVideo.videoHeight || outH;

      const scale = Math.min(outW / vw, outH / vh);
      const dw = Math.floor(vw * scale);
      const dh = Math.floor(vh * scale);
      const dx = Math.floor((outW - dw) / 2);
      const dy = Math.floor((outH - dh) / 2);

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(xVideo, 0, 0, vw, vh, dx, dy, dw, dh);
    }

    rafId = requestAnimationFrame(drawFrame);
  }

  const donePromise = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () =>
      reject(new Error("Recorder error during conversion"));
  });

  recorder.start(1000);
  try {
    await xVideo.play();
  } catch (_) {}
  rafId = requestAnimationFrame(drawFrame);

  await new Promise((resolve) => {
    xVideo.onended = () => resolve();
  });

  cancelAnimationFrame(rafId);
  try {
    recorder.stop();
  } catch (_) {}
  await donePromise;

  URL.revokeObjectURL(inputUrl);

  const outType = recorder.mimeType || outMime || "video/webm";
  return new Blob(outChunks, { type: outType });
}

async function compressIteratively(inputBlob) {
  cancelRequested = false;
  cancelConvertBtn.disabled = false;
  convertBtn.disabled = true;

  showProgress(true);
  attemptText.textContent = "—";
  progressText.textContent = "Starting…";
  progressLog.textContent = "";

  const targetBytes = MAX_BYTES - SAFETY_BYTES;

  const meta = await getVideoMeta(inputBlob);
  const durationSec = Math.max(1, Math.round(meta.duration || 1));

  logProgress(
    `${sourceLabel || "Source"} size: ${fmtMB(inputBlob.size)} | duration ~${durationSec}s | meta ${meta.width}x${meta.height}`,
  );

  if (inputBlob.size <= targetBytes) {
    logProgress(`Already under limit (≤ ${fmtMB(targetBytes)}).`);
    return inputBlob;
  }

  const maxRes = parseWH(convertResSelect.value);

  const [minResStr, minKbpsStr] = minQualitySelect.value.split("|");
  const minRes = parseWH(minResStr);
  const minVideoBps = Number(minKbpsStr) * 1000;

  const tiers = [
    { w: 1280, h: 720 },
    { w: 854, h: 480 },
    { w: 640, h: 360 },
    { w: 426, h: 240 },
    { w: 320, h: 180 },
  ];

  let outW = Math.min(maxRes.w, meta.width || maxRes.w);
  let outH = Math.min(maxRes.h, meta.height || maxRes.h);
  const startTier =
    tiers.find((t) => t.w <= outW && t.h <= outH) || tiers[tiers.length - 1];
  outW = startTier.w;
  outH = startTier.h;

  const fps = Number(fpsSelect.value) || 30;

  let attempt = 0;
  const MAX_ATTEMPTS = 10;

  let { videoBps, audioBps } = computeBitratesForTarget(
    durationSec,
    targetBytes,
  );
  videoBps = Math.min(videoBps, 2_000_000);

  while (attempt < MAX_ATTEMPTS) {
    if (cancelRequested) throw new Error("cancelled");

    attempt++;
    attemptText.textContent = String(attempt);
    progressText.textContent = "Encoding…";

    logProgress(`\n--- Attempt ${attempt} ---`);
    logProgress(
      `Try ${outW}x${outH} @ ~${Math.floor(videoBps / 1000)} kbps video`,
    );

    let outBlob;
    try {
      outBlob = await transcodeViaCanvas(
        inputBlob,
        outW,
        outH,
        fps,
        videoBps,
        audioBps,
      );
    } catch (e) {
      logProgress(`Convert error: ${e.message || e}`);

      const next = scaleDownTier(outW, outH);
      outW = next.w;
      outH = next.h;

      ({ videoBps, audioBps } = computeBitratesForTarget(
        durationSec,
        targetBytes,
      ));
      videoBps = Math.max(minVideoBps, Math.min(videoBps, 1_200_000));
      continue;
    }

    logProgress(
      `Output: ${fmtMB(outBlob.size)} | mime: ${outBlob.type || "unknown"}`,
    );

    if (outBlob.size <= targetBytes) {
      logProgress(`✅ Success under limit (≤ ${fmtMB(targetBytes)}).`);
      progressText.textContent = "Done";
      return outBlob;
    }

    if (videoBps > minVideoBps * 1.15) {
      videoBps = Math.max(minVideoBps, Math.floor(videoBps * 0.72));
      logProgress(
        `Still too big → lowering bitrate to ~${Math.floor(videoBps / 1000)} kbps`,
      );
    } else {
      const next = scaleDownTier(outW, outH);
      outW = next.w;
      outH = next.h;

      if (outW < minRes.w || outH < minRes.h) {
        throw new Error(
          "Reached minimum quality floor; cannot compress under 50MB for this duration.",
        );
      }

      ({ videoBps, audioBps } = computeBitratesForTarget(
        durationSec,
        targetBytes,
      ));
      videoBps = Math.max(minVideoBps, Math.min(videoBps, 1_200_000));
      logProgress(
        `Bitrate floor reached → downscaling to ${outW}x${outH}, reset bitrate ~${Math.floor(videoBps / 1000)} kbps`,
      );
    }
  }

  throw new Error(
    "Max attempts reached; could not compress under 50MB on this device.",
  );
}

/********************************************************************
 * Convert
 ********************************************************************/
convertBtn.addEventListener("click", async () => {
  if (!sourceBlob) return;

  cancelRequested = false;
  cancelConvertBtn.disabled = false;
  convertBtn.disabled = true;

  try {
    clearResult();
    showProgress(true);
    logProgress(
      `Starting conversion… target ≤ ${fmtMB(MAX_BYTES - SAFETY_BYTES)}`,
    );

    const out = await compressIteratively(sourceBlob);

    showProgress(false);
    cancelConvertBtn.disabled = true;
    cancelRequested = false;

    renderResult(out, "Final (≤ 50MB)");
  } catch (e) {
    showProgress(false);
    cancelConvertBtn.disabled = true;

    const msg = e && e.message ? e.message : String(e);
    alert(msg);
    logProgress(`❌ Failed: ${msg}`);
  } finally {
    cancelRequested = false;
    updateConvertButtonState();
  }
});

cancelConvertBtn.addEventListener("click", () => {
  cancelRequested = true;
  cancelConvertBtn.disabled = true;
  logProgress("Cancel requested…");
  progressText.textContent = "Cancelling…";
});

/********************************************************************
 * Enable/restart camera (gesture-required on iOS)
 ********************************************************************/
enableCameraBtn.addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("This browser does not support camera access.");
      return;
    }
    if (!isSecureEnoughForCamera()) {
      alert(
        "On iPhone, camera requires HTTPS. Hosting this page on HTTPS is the best fix.",
      );
    }

    lsSet(LS_KEYS.AUTO_ENABLE_CAMERA, true);

    await startPreview();
    await populateCameras();

    if (!cameraSelect.value && cameraSelect.options[0]) {
      cameraSelect.value = cameraSelect.options[0].value;
      lsSet(LS_KEYS.CAMERA_ID, cameraSelect.value);
    }
    await startPreview();

    restartPreviewBtn.disabled = false;
    recordToggleBtn.disabled = false;

    cameraStateLabel.textContent = "Enabled";
  } catch (e) {
    console.error(e);
    alert(
      "Could not start camera. If you opened from Files on iPhone, host it on HTTPS.",
    );
  }
});

restartPreviewBtn.addEventListener("click", async () => {
  try {
    await startPreview();
  } catch (e) {
    console.error(e);
    alert("Preview restart failed.");
  }
});

/********************************************************************
 * Reset
 ********************************************************************/
resetBtn.addEventListener("click", () => {
  resetRecordingState();
  clearResult();
  sourceBlob = null;
  sourceLabel = "";
  updateConvertButtonState();
  resetBtn.disabled = true;
});

/********************************************************************
 * Tabs
 ********************************************************************/
tabRecord.addEventListener("click", () => setMode("record"));
tabUpload.addEventListener("click", () => setMode("upload"));

/********************************************************************
 * Settings live updates + persist
 ********************************************************************/
recordBitrate.addEventListener("input", () => {
  recordBitrateLabel.textContent = recordBitrate.value;
  lsSet(LS_KEYS.BITRATE_KBPS, recordBitrate.value);
});
convertResSelect.addEventListener("change", () => {
  lsSet(LS_KEYS.CONVERT_RES, convertResSelect.value);
});
minQualitySelect.addEventListener("change", () => {
  lsSet(LS_KEYS.MIN_QUALITY, minQualitySelect.value);
});

/********************************************************************
 * Init (restore settings)
 ********************************************************************/
function restoreSettingsFromStorage() {
  const savedMode = lsGet(LS_KEYS.MODE, "record");
  mode = savedMode === "upload" ? "upload" : "record";

  const savedFps = lsGet(LS_KEYS.FPS, "");
  if (savedFps) fpsSelect.value = savedFps;
  if (!fpsSelect.value) fpsSelect.value = "30";

  const savedPrevRes = lsGet(LS_KEYS.PREVIEW_RES, "");
  if (savedPrevRes) previewResSelect.value = savedPrevRes;

  const savedConvRes = lsGet(LS_KEYS.CONVERT_RES, "");
  if (savedConvRes) convertResSelect.value = savedConvRes;

  const savedBitrate = lsGet(LS_KEYS.BITRATE_KBPS, "");
  if (savedBitrate) recordBitrate.value = savedBitrate;

  const savedMinQ = lsGet(LS_KEYS.MIN_QUALITY, "");
  if (savedMinQ) minQualitySelect.value = savedMinQ;

  recordBitrateLabel.textContent = recordBitrate.value;

  // Labels
  cameraStateLabel.textContent = lsGetBool(LS_KEYS.AUTO_ENABLE_CAMERA, false)
    ? "Tap Enable"
    : "Not enabled";
  recStateLabel.textContent = "Idle";
  convertStateLabel.textContent = "Ready";
}

function init() {
  limitLabel.textContent = fmtMB(MAX_BYTES);
  restoreSettingsFromStorage();

  if (!isSecureEnoughForCamera()) secureBanner.style.display = "block";

  preferredOutputMime = pickPreferredOutputMime();
  updateOutputBadges();

  setMode(mode);
  updateRecUI();
  clearResult();

  // iOS gesture requirement: don’t auto-start camera
  recordToggleBtn.disabled = true;
  pauseBtn.disabled = true;
  restartPreviewBtn.disabled = true;
  resetBtn.disabled = true;
}

init();
