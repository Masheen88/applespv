// main.js
/********************************************************************
 * 50MB Video Recorder/Converter (MP4-first)
 * - No FFmpeg. Uses canvas re-encode via MediaRecorder.
 * - MP4 output is ONLY possible if the browser can encode MP4.
 *
 * UPDATES:
 * - Adds per-attempt conversion progress bar + % + ETA
 * - Makes conversion silent (no "listening to the whole video")
 *
 * NEW (iPhone MOV -> MP4):
 * - If browser supports MP4 encoding AND uploaded input is not MP4 (e.g. .MOV),
 *   we FORCE a transcode to MP4 even if the file is already under 50MB.
 ********************************************************************/

// GorillaDesk limit
const MAX_BYTES = 50 * 1024 * 1024;
const SAFETY_BYTES = 512 * 1024; // keep a little buffer under 50MB

/********************************************************************
 * DOM helpers (single source of truth)
 ********************************************************************/
const $ = (id) => document.getElementById(id);

function pickUI(ids) {
  const out = {};
  ids.forEach((id) => (out[id] = $(id)));
  return out;
}

const UI = {
  ...pickUI([
    "limitLabel",
    "secureBanner",
    "mp4Banner",

    "tabRecord",
    "tabUpload",
    "recordPanel",
    "uploadPanel",
    "cameraGroup",

    "preview",
    "enableCameraBtn",
    "restartPreviewBtn",

    "recordToggleBtn",
    "pauseBtn",
    "resetBtn",

    "fileInput",

    "convertBtn",
    "cancelConvertBtn",

    "recSizeLabel",
    "recTimeLabel",
    "recBarFill",

    "preferredMimeLabel",
    "gdCompatLabel",

    "progressBox",
    "attemptText",
    "progressText",
    "progressLog",

    // NEW progress UI
    "convBarFill",
    "convPctLabel",
    "convEtaLabel",

    "resultArea",

    // Settings
    "settingsBtn",
    "themeBtn",
    "sheetOverlay",
    "sheet",
    "closeSheetBtn",

    "cameraSelect",
    "fpsSelect",
    "previewResSelect",
    "convertResSelect",
    "recordBitrate",
    "recordBitrateLabel",
    "minQualitySelect",

    "torchBtn",
    "zoomRange",
    "zoomValue",

    "torchLabel",
    "zoomLabel",

    "cameraStateLabel",
    "recStateLabel",
    "convertStateLabel",

    // Modal preview
    "modalOverlay",
    "videoModal",
    "closeModalBtn",
    "modalVideo",
    "modalMetaNote",

    // Combo tab
    "comboPreview",
    "comboHudText",
    "comboStateNote",
    "comboEnableCameraBtn",
    "comboRecordToggleBtn",
    "comboPauseBtn",
    "comboStartPathBtn",
    "comboDropPointBtn",
    "comboCenterBtn",
    "comboExitBtn",

    // Hidden tools for conversion
    "xCanvas",
    "xVideo",
  ]),
};

// Map buttons (live in map tab; may be hidden while using combo tab)
const MAP = {
  startTrackBtn: $("startTrackBtn"),
  dropPointBtn: $("dropPointBtn"),
  mapCenterBtn: $("mapCenterBtn"),
};

/********************************************************************
 * Tiny UI helpers
 ********************************************************************/
function show(el, on) {
  if (!el) return;
  el.style.display = on ? "block" : "none";
}
function showInline(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}
function setText(el, txt) {
  if (!el) return;
  el.textContent = String(txt);
}
function setEnabled(el, on) {
  if (!el) return;
  el.disabled = !on;
}
function setHtml(el, html) {
  if (!el) return;
  el.innerHTML = html;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/********************************************************************
 * Local Storage (remember settings)
 ********************************************************************/
const LS_KEYS = {
  THEME: "vd_theme",
  MODE: "vd_mode", // record | upload
  FPS: "vd_fps",
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
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS_KEYS.THEME, theme);
}
applyTheme(localStorage.getItem(LS_KEYS.THEME) || "dark");
UI.themeBtn?.addEventListener("click", () => {
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
 * Conversion progress state (NEW)
 ********************************************************************/
let convAttemptStartPerf = 0;
let convLastProgressUpdatePerf = 0;

/********************************************************************
 * Helpers
 ********************************************************************/
function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
function isSecureEnoughForCamera() {
  return globalThis.isSecureContext === true;
}
function safeIsTypeSupported(mime) {
  try {
    return !!MediaRecorder.isTypeSupported?.(mime);
  } catch (error) {
    console.error("An error has ocurred:", error);

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
  return "mp4"; // keep your original fallback
}

function isMp4Supported() {
  return (
    safeIsTypeSupported("video/mp4") ||
    safeIsTypeSupported("video/mp4;codecs=avc1.42E01E,mp4a.40.2") ||
    safeIsTypeSupported("video/mp4;codecs=avc1.4D401E,mp4a.40.2")
  );
}

function isMp4Mime(mime) {
  return (mime || "").toLowerCase().includes("video/mp4");
}

/********************************************************************
 * UI updates
 ********************************************************************/
function updateOutputBadges() {
  setText(UI.preferredMimeLabel, preferredOutputMime || "(browser default)");

  const compat = isGorillaDeskCompatibleMime(preferredOutputMime);
  setText(UI.gdCompatLabel, compat ? "YES" : "NO");
  if (UI.gdCompatLabel)
    UI.gdCompatLabel.className = "mono " + (compat ? "ok" : "warn");

  const mp4Supported =
    safeIsTypeSupported("video/mp4") ||
    safeIsTypeSupported("video/mp4;codecs=avc1.42E01E,mp4a.40.2") ||
    safeIsTypeSupported("video/mp4;codecs=avc1.4D401E,mp4a.40.2");

  show(UI.mp4Banner, !mp4Supported);
}

function setMode(next) {
  mode = next;
  lsSet(LS_KEYS.MODE, mode);

  const isRecord = mode === "record";
  UI.tabRecord?.classList.toggle("active", isRecord);
  UI.tabUpload?.classList.toggle("active", !isRecord);
  UI.cameraGroup?.classList.toggle("active", isRecord);

  UI.tabRecord?.setAttribute("aria-selected", isRecord ? "true" : "false");
  UI.tabUpload?.setAttribute("aria-selected", !isRecord ? "true" : "false");

  //TODO if upload don't show id cameraGroup else show it toggle it by that id
  showInline(UI.cameraGroup, isRecord);

  showInline(UI.recordPanel, isRecord);
  showInline(UI.uploadPanel, !isRecord);

  updateConvertButtonState();
}

function updateConvertButtonState() {
  const blocked =
    !sourceBlob ||
    (mediaRecorder && mediaRecorder.state !== "inactive") ||
    cancelRequested;

  setEnabled(UI.convertBtn, !blocked);
  setText(UI.convertStateLabel, blocked ? "Waiting…" : "Ready");
}

function showProgress(on) {
  show(UI.progressBox, on);
  if (!on) {
    setText(UI.attemptText, "—");
    setText(UI.progressText, "—");
    setText(UI.progressLog, "");
  }

  // reset progress bar
  if (UI.convBarFill) UI.convBarFill.style.width = "0%";
  setText(UI.convPctLabel, on ? "0%" : "—");
  setText(UI.convEtaLabel, on ? "—" : "—");

  convAttemptStartPerf = 0;
  convLastProgressUpdatePerf = 0;
}

function logProgress(line) {
  if (!UI.progressLog) return;
  UI.progressLog.textContent = (
    UI.progressLog.textContent +
    "\n" +
    line
  ).trim();
  UI.progressLog.scrollTop = UI.progressLog.scrollHeight;
}

function updateRecUI() {
  setText(UI.recSizeLabel, fmtMB(recordedBytes));

  const secs = startTs
    ? Math.max(0, Math.floor((Date.now() - startTs) / 1000))
    : 0;
  setText(UI.recTimeLabel, fmtTime(secs));

  const pct = Math.min(100, (recordedBytes / MAX_BYTES) * 100);
  if (UI.recBarFill) UI.recBarFill.style.width = pct.toFixed(1) + "%";

  setText(
    UI.torchLabel,
    UI.torchBtn?.disabled ? "n/a" : torchOn ? "On" : "Off",
  );
  setText(
    UI.zoomLabel,
    UI.zoomRange?.disabled
      ? "n/a"
      : Number(UI.zoomRange.value).toFixed(1) + "x",
  );
}

function clearResult() {
  if (lastResultUrl) {
    try {
      URL.revokeObjectURL(lastResultUrl);
    } catch (_) {}
  }
  lastResultUrl = "";
  lastResultBlob = null;
  lastResultLabel = "";

  setHtml(
    UI.resultArea,
    `<div class="note">Converted output will appear here with Save/Share.</div>`,
  );
}

/********************************************************************
 * Conversion progress (NEW)
 * - progress: 0..1
 ********************************************************************/
function setConversionProgress(progress01, curSec, durSec, attemptNumber) {
  const p = clamp(progress01 || 0, 0, 1);
  const pct = Math.round(p * 100);

  if (UI.convBarFill) UI.convBarFill.style.width = pct + "%";
  setText(UI.convPctLabel, `${pct}% (${fmtTime(curSec)} / ${fmtTime(durSec)})`);

  // ETA estimate (simple, but useful)
  const now = performance.now();
  if (!convAttemptStartPerf) convAttemptStartPerf = now;
  const elapsed = (now - convAttemptStartPerf) / 1000;

  // throttle ETA text updates a bit
  if (!convLastProgressUpdatePerf || now - convLastProgressUpdatePerf > 250) {
    convLastProgressUpdatePerf = now;

    if (p > 0.02) {
      const totalEst = elapsed / p;
      const eta = Math.max(0, totalEst - elapsed);
      setText(UI.convEtaLabel, `~${fmtTime(eta)} (Attempt ${attemptNumber})`);
    } else {
      setText(UI.convEtaLabel, `Estimating… (Attempt ${attemptNumber})`);
    }
  }
}

/********************************************************************
 * Preview modal (keeps inert behavior)
 ********************************************************************/
function openPreviewModal(blob, label) {
  if (!blob || !UI.modalOverlay || !UI.videoModal || !UI.modalVideo) return;

  UI.modalOverlay.hidden = false;
  UI.videoModal.hidden = false;
  UI.videoModal.removeAttribute("inert");

  const url = URL.createObjectURL(blob);
  UI.modalVideo.src = url;
  UI.videoModal.dataset.tempUrl = url;

  const ext = guessExtensionForMime(blob.type || preferredOutputMime || "");
  if (UI.modalMetaNote) {
    UI.modalMetaNote.textContent = `${label || "Video"} • ${fmtMB(blob.size)} • ${
      blob.type || "video/*"
    } • .${ext}`;
  }

  UI.closeModalBtn?.focus();

  setTimeout(() => {
    try {
      UI.modalVideo.play();
    } catch (_) {}
  }, 0);
}

function closePreviewModal() {
  if (!UI.modalOverlay || !UI.videoModal || !UI.modalVideo) return;

  if (UI.videoModal.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  try {
    UI.modalVideo.pause();
  } catch (_) {}

  const tempUrl = UI.videoModal.dataset.tempUrl || "";
  if (tempUrl) {
    try {
      URL.revokeObjectURL(tempUrl);
    } catch (_) {}
  }
  UI.videoModal.dataset.tempUrl = "";

  UI.videoModal.setAttribute("inert", "");
  UI.videoModal.hidden = true;
  UI.modalOverlay.hidden = true;
}

UI.closeModalBtn?.addEventListener("click", closePreviewModal);
UI.modalOverlay?.addEventListener("click", closePreviewModal);

/********************************************************************
 * Settings sheet (fixed bounds)
 ********************************************************************/
function openSheet() {
  if (!UI.sheetOverlay || !UI.sheet) return;
  UI.sheetOverlay.style.display = "block";
  UI.sheet.style.transform = "translateY(0)";
  UI.sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  if (!UI.sheetOverlay || !UI.sheet) return;
  UI.sheetOverlay.style.display = "none";
  UI.sheet.style.transform = "translateY(110%)";
  UI.sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

UI.settingsBtn?.addEventListener("click", openSheet);
UI.closeSheetBtn?.addEventListener("click", closeSheet);
UI.sheetOverlay?.addEventListener("click", closeSheet);

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
  lastResultBlob = blob;
  lastResultLabel = label || "Output";

  const url = URL.createObjectURL(blob);
  lastResultUrl = url;

  // IMPORTANT:
  // If the blob mime is empty/unknown but we *know* MP4 is supported and we intended MP4,
  // still save as mp4 by extension guessing.
  const ext = guessExtensionForMime(blob.type || preferredOutputMime || "");
  const okSize = blob.size <= MAX_BYTES - SAFETY_BYTES;
  const gdOk = isGorillaDeskCompatibleMime(blob.type || "");

  setHtml(
    UI.resultArea,
    `
    <div class="pill" style="width:100%; justify-content:space-between; margin-bottom:10px;">
      <span>${label || "Output"}: <span class="mono ${okSize ? "ok" : "warn"}">${fmtMB(
        blob.size,
      )}</span></span>
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
  `,
  );

  const previewBtn = $("previewBtn");
  previewBtn?.addEventListener("click", () => openPreviewModal(blob, label));

  const shareBtn = $("shareBtn");
  shareBtn?.addEventListener("click", async () => {
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
 * Camera controls (torch/zoom)
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
    setText(UI.torchBtn, torchOn ? "🔦 Torch: On" : "🔦 Torch: Off");
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
    setText(UI.zoomValue, Number(z).toFixed(1) + "x");
    updateRecUI();
  } catch (e) {
    // ignore while sliding
  }
}

function setupTorchZoomUI() {
  torchOn = false;
  setEnabled(UI.torchBtn, false);
  setText(UI.torchBtn, "🔦 Torch: n/a");

  setEnabled(UI.zoomRange, false);
  setText(UI.zoomValue, "n/a");

  if (!videoTrack) {
    updateRecUI();
    return;
  }

  const caps = getCapsSafe(videoTrack);

  if (caps.torch) {
    setEnabled(UI.torchBtn, true);
    setText(UI.torchBtn, "🔦 Torch: Off");
  }

  if (
    caps.zoom &&
    typeof caps.zoom.min === "number" &&
    typeof caps.zoom.max === "number"
  ) {
    setEnabled(UI.zoomRange, true);
    UI.zoomRange.min = caps.zoom.min;
    UI.zoomRange.max = caps.zoom.max;
    UI.zoomRange.step = caps.zoom.step || 0.1;

    const settings = (videoTrack.getSettings && videoTrack.getSettings()) || {};
    const zFromTrack =
      typeof settings.zoom === "number" ? settings.zoom : caps.zoom.min;

    const zSaved = lsGetNum(LS_KEYS.ZOOM, zFromTrack);
    const zClamped = Math.min(caps.zoom.max, Math.max(caps.zoom.min, zSaved));

    UI.zoomRange.value = zClamped;
    setText(UI.zoomValue, Number(zClamped).toFixed(1) + "x");
  }

  updateRecUI();
}

UI.torchBtn?.addEventListener("click", () => applyTorch(!torchOn));
UI.zoomRange?.addEventListener("input", (e) => applyZoom(e.target.value));

/********************************************************************
 * Camera setup
 ********************************************************************/
function stopStream() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  videoTrack = null;

  // Clear previews
  try {
    UI.preview.srcObject = null;
  } catch (_) {}
  try {
    if (UI.comboPreview) UI.comboPreview.srcObject = null;
  } catch (_) {}

  setText(UI.cameraStateLabel, "Not enabled");
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
  if (!UI.cameraSelect) return;
  UI.cameraSelect.innerHTML = "";

  const cams = await getDevices();
  cams.forEach((cam, idx) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Camera ${idx + 1}`;
    UI.cameraSelect.appendChild(opt);
  });

  const bestId = pickBestBackCameraId(cams);
  if (bestId) UI.cameraSelect.value = bestId;

  if (UI.cameraSelect.value) lsSet(LS_KEYS.CAMERA_ID, UI.cameraSelect.value);
}

async function startPreview() {
  stopStream();
  torchOn = false;

  const [w, h] = (UI.previewResSelect?.value || "1280x720")
    .split("x")
    .map(Number);
  const fps = Number(UI.fpsSelect?.value) || 30;

  const selectedId = UI.cameraSelect?.value || "";
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

  UI.preview.srcObject = stream;
  if (UI.comboPreview) UI.comboPreview.srcObject = stream;

  try {
    await UI.preview.play();
  } catch (_) {}

  videoTrack = stream.getVideoTracks()[0] || null;
  setupTorchZoomUI();

  setText(UI.cameraStateLabel, "Enabled");
  setEnabled(UI.recordToggleBtn, true);
  setEnabled(UI.pauseBtn, false);

  // Sync cameraSelect with actual deviceId if present
  try {
    const settings =
      (videoTrack && videoTrack.getSettings && videoTrack.getSettings()) || {};
    if (settings.deviceId && UI.cameraSelect) {
      const has = Array.from(UI.cameraSelect.options).some(
        (o) => o.value === settings.deviceId,
      );
      if (has) {
        UI.cameraSelect.value = settings.deviceId;
        lsSet(LS_KEYS.CAMERA_ID, settings.deviceId);
      }
    }
  } catch (_) {}

  // Restore torch (best-effort)
  const torchWanted = lsGetBool(LS_KEYS.TORCH_ON, false);
  if (torchWanted && UI.torchBtn && !UI.torchBtn.disabled) {
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: true }] });
      torchOn = true;
      setText(UI.torchBtn, "🔦 Torch: On");
    } catch (_) {}
  }

  // Restore zoom (best-effort)
  if (UI.zoomRange && !UI.zoomRange.disabled) {
    const z = lsGetNum(LS_KEYS.ZOOM, Number(UI.zoomRange.value));
    try {
      await applyZoom(z);
      UI.zoomRange.value = z;
    } catch (_) {}
  }

  updateRecUI();
}

UI.cameraSelect?.addEventListener("change", async () => {
  lsSet(LS_KEYS.CAMERA_ID, UI.cameraSelect.value || "");
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  try {
    await startPreview();
  } catch (e) {
    console.error(e);
  }
});

UI.previewResSelect?.addEventListener("change", async () => {
  lsSet(LS_KEYS.PREVIEW_RES, UI.previewResSelect.value);
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  try {
    await startPreview();
  } catch (e) {
    console.error(e);
  }
});

UI.fpsSelect?.addEventListener("change", async () => {
  lsSet(LS_KEYS.FPS, UI.fpsSelect.value);
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

  setText(UI.recStateLabel, "Idle");
  updateRecUI();
}

function bestRecorderMimeForCurrentDevice() {
  const mime = preferredOutputMime || pickPreferredOutputMime();
  return mime || "";
}

async function startRecording() {
  if (!stream) {
    alert("Tap Enable Camera first.");
    return;
  }

  cancelRequested = false;
  setEnabled(UI.cancelConvertBtn, false);

  resetRecordingState();
  clearResult();

  const mimeType = bestRecorderMimeForCurrentDevice();
  const options = {};
  if (mimeType) options.mimeType = mimeType;
  options.videoBitsPerSecond = Number(UI.recordBitrate?.value || 1500) * 1000;

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
    setEnabled(UI.recordToggleBtn, true);
    setEnabled(UI.pauseBtn, false);
    setEnabled(UI.resetBtn, true);

    UI.recordToggleBtn?.classList.remove("danger");
    UI.recordToggleBtn?.classList.add("primary");
    setText(UI.recordToggleBtn, "⏺️ Record");

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;

    setText(UI.recStateLabel, "Stopped");

    const type = mediaRecorder.mimeType || mimeType || "video/webm";
    const blob = new Blob(chunks, { type });

    sourceBlob = blob;
    sourceLabel = "Recorded";
    updateConvertButtonState();

    renderResult(blob, "Raw (recorded)");
  };

  mediaRecorder.onpause = () => {
    setText(UI.recStateLabel, "Paused");
    setText(UI.pauseBtn, "▶️ Resume");
  };

  mediaRecorder.onresume = () => {
    setText(UI.recStateLabel, "Recording");
    setText(UI.pauseBtn, "⏸️ Pause");
  };

  mediaRecorder.start(TIMESLICE_MS);
  startTs = Date.now();

  setText(UI.recStateLabel, "Recording");

  setEnabled(UI.recordToggleBtn, true);
  UI.recordToggleBtn?.classList.remove("primary");
  UI.recordToggleBtn?.classList.add("danger");
  setText(UI.recordToggleBtn, "⏹️ Stop");

  setEnabled(UI.pauseBtn, true);
  setText(UI.pauseBtn, "⏸️ Pause");

  setEnabled(UI.resetBtn, false);

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

UI.recordToggleBtn?.addEventListener("click", toggleRecord);
UI.pauseBtn?.addEventListener("click", togglePause);

/********************************************************************
 * Upload
 ********************************************************************/
UI.fileInput?.addEventListener("change", async () => {
  const f = UI.fileInput.files && UI.fileInput.files[0];
  if (!f) {
    sourceBlob = null;
    updateConvertButtonState();
    return;
  }

  sourceBlob = f;
  sourceLabel = "Uploaded";
  cancelRequested = false;
  setEnabled(UI.cancelConvertBtn, false);

  updateConvertButtonState();
  clearResult();

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
  attemptNumber,
) {
  if (cancelRequested) throw new Error("cancelled");

  const inputUrl = URL.createObjectURL(inputBlob);

  // SILENT conversion playback
  UI.xVideo.src = inputUrl;

  // - Do NOT set muted=true, because it can silence the MediaElementSource graph.
  // - Keep it silent by setting volume=0 and using a 0-gain monitor node.
  UI.xVideo.muted = false;
  UI.xVideo.volume = 0;
  UI.xVideo.playsInline = true;
  UI.xVideo.preload = "auto";

  await new Promise((resolve, reject) => {
    UI.xVideo.onloadedmetadata = () => resolve();
    UI.xVideo.onerror = () =>
      reject(new Error("Failed to load video for conversion"));
  });

  const dur = Number.isFinite(UI.xVideo.duration) ? UI.xVideo.duration : 0;

  UI.xCanvas.width = outW;
  UI.xCanvas.height = outH;
  const ctx = UI.xCanvas.getContext("2d", { alpha: false });

  const canvasStream = UI.xCanvas.captureStream(fps);

  // Best-effort audio capture WITHOUT audible output
  let mixedStream = canvasStream;
  let ac = null;
  let dest = null;

  try {
    ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)();

    // On iOS, the AudioContext may start suspended even during “button click” flows.
    // Calling resume() here makes audio rendering far more reliable.
    if (ac.state === "suspended") {
      try {
        await ac.resume();
      } catch (error) {
        console.error("AudioContext resume failed:", error);
      }
    }

    const srcNode = ac.createMediaElementSource(UI.xVideo);
    dest = ac.createMediaStreamDestination();

    // Route into the recording destination (this is what we capture)
    srcNode.connect(dest);

    // ALSO create a silent monitor path to keep the audio graph “alive” on iOS.
    // (0 gain -> destination = silent)
    const zeroGain = ac.createGain();
    zeroGain.gain.value = 0;

    srcNode.connect(zeroGain);
    zeroGain.connect(ac.destination);

    const audioTrack = dest.stream.getAudioTracks()[0] || null;
    if (audioTrack) {
      mixedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        audioTrack,
      ]);
    }
  } catch (error) {
    console.error("Audio capture failed:", error);
    // audio capture may fail on some browsers; video-only still works
  }
  const outMime = bestRecorderMimeForCurrentDevice();
  const options = {};
  if (outMime) options.mimeType = outMime;
  options.videoBitsPerSecond = Math.floor(videoBps);
  options.audioBitsPerSecond = Math.floor(audioBps);

  let recorder;
  try {
    recorder = new MediaRecorder(mixedStream, options);
  } catch (error) {
    URL.revokeObjectURL(inputUrl);
    console.error("MediaRecorder initialization failed:", error);
    throw new Error(
      "MediaRecorder cannot encode with these settings on this device/browser.",
    );
  }

  const outChunks = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) outChunks.push(ev.data);
  };

  // Draw loop + progress reporting
  let rafId = 0;
  let lastFrameTs = 0;
  const frameInterval = 1000 / fps;

  convAttemptStartPerf = performance.now();
  convLastProgressUpdatePerf = 0;

  function drawFrame(ts) {
    if (cancelRequested) {
      try {
        recorder.stop();
      } catch (error) {
        console.error("Error stopping recorder after cancellation:", error);
      }
      return;
    }

    if (!lastFrameTs || ts - lastFrameTs >= frameInterval) {
      lastFrameTs = ts;

      const vw = UI.xVideo.videoWidth || outW;
      const vh = UI.xVideo.videoHeight || outH;

      const scale = Math.min(outW / vw, outH / vh);
      const dw = Math.floor(vw * scale);
      const dh = Math.floor(vh * scale);
      const dx = Math.floor((outW - dw) / 2);
      const dy = Math.floor((outH - dh) / 2);

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(UI.xVideo, 0, 0, vw, vh, dx, dy, dw, dh);

      // progress update
      const cur = UI.xVideo.currentTime || 0;
      const progress01 = dur > 0 ? cur / dur : 0;
      setConversionProgress(progress01, cur, dur, attemptNumber);
    }

    rafId = requestAnimationFrame(drawFrame);
  }

  const donePromise = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () =>
      reject(new Error("Recorder error during conversion"));
  });

  recorder.start(1000);

  // Start playback (still silent)
  try {
    await UI.xVideo.play();
  } catch (error) {
    console.error("Video playback failed during conversion:", error);
    recorder.stop();
    URL.revokeObjectURL(inputUrl);
    throw new Error("Video playback failed during conversion.");
  }

  rafId = requestAnimationFrame(drawFrame);

  await new Promise((resolve) => {
    UI.xVideo.onended = () => resolve();
  });

  cancelAnimationFrame(rafId);
  try {
    recorder.stop();
  } catch (_) {}
  await donePromise;

  URL.revokeObjectURL(inputUrl);

  const outType = recorder.mimeType || outMime || "video/webm";

  // Cleanup audio graph (prevents leaks / stuck audio on iOS)
  try {
    if (dest?.stream) {
      dest.stream.getTracks().forEach((t) => t.stop());
    }
  } catch (error) {
    console.error("Error stopping audio tracks during cleanup:", error);
  }
  try {
    if (ac && ac.state !== "closed") await ac.close();
  } catch (error) {
    console.error("Error closing AudioContext during cleanup:", error);
  }

  return new Blob(outChunks, { type: outType });
}

/********************************************************************
 * compressIteratively
 *
 * NEW:
 * - If under 50MB but not MP4 and MP4 encoding is supported,
 *   do a single-pass transcode to force MP4 output.
 * - If that MP4 result ends up too big, continue compressing the MP4 blob.
 ********************************************************************/
async function compressIteratively(inputBlob) {
  cancelRequested = false;
  setEnabled(UI.cancelConvertBtn, true);
  setEnabled(UI.convertBtn, false);

  showProgress(true);
  setText(UI.attemptText, "—");
  setText(UI.progressText, "Starting…");
  setText(UI.progressLog, "");

  const targetBytes = MAX_BYTES - SAFETY_BYTES;

  const meta = await getVideoMeta(inputBlob);
  const durationSec = Math.max(1, Math.round(meta.duration || 1));

  logProgress(
    `${sourceLabel || "Source"} size: ${fmtMB(inputBlob.size)} | duration ~${durationSec}s | meta ${meta.width}x${meta.height}`,
  );

  // Decide whether we should force MP4 even if already under the size limit.
  const mp4Ok = isMp4Supported();
  const inputIsMp4 = isMp4Mime(inputBlob.type);
  const forceMp4 = mp4Ok && !inputIsMp4;

  if (inputBlob.size <= targetBytes && !forceMp4) {
    logProgress(`Already under limit (≤ ${fmtMB(targetBytes)}).`);
    return inputBlob;
  }

  // Under limit but MOV/QuickTime: force a transcode to MP4.
  // IMPORTANT: We target slightly under the input size to avoid "growing" the output.
  if (inputBlob.size <= targetBytes && forceMp4) {
    logProgress(
      `Under limit but input is ${inputBlob.type || "video/*"} → forcing MP4 output…`,
    );

    const maxRes = parseWH(UI.convertResSelect?.value || "1280x720");
    const fps = Number(UI.fpsSelect?.value) || 30;

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

    // Aim just under current size.
    const remuxTargetBytes = Math.min(
      targetBytes,
      Math.max(1_000_000, Math.floor(inputBlob.size * 0.98)),
    );

    let { videoBps, audioBps } = computeBitratesForTarget(
      durationSec,
      remuxTargetBytes,
    );
    videoBps = Math.min(videoBps, 2_000_000);

    // Single attempt (attemptNumber=1) is enough for container change.
    const outBlob = await transcodeViaCanvas(
      inputBlob,
      outW,
      outH,
      fps,
      videoBps,
      audioBps,
      1,
    );

    logProgress(
      `Forced MP4 output: ${fmtMB(outBlob.size)} | mime: ${outBlob.type || "unknown"}`,
    );

    // If still under the actual 50MB target, done.
    if (outBlob.size <= targetBytes) {
      logProgress(
        `✅ MP4 output produced under limit (≤ ${fmtMB(targetBytes)}).`,
      );
      setText(UI.progressText, "Done");
      if (UI.convBarFill) UI.convBarFill.style.width = "100%";
      setText(UI.convPctLabel, "100%");
      setText(UI.convEtaLabel, "0s");
      return outBlob;
    }

    // If MP4 came out larger (rare), continue compressing starting from MP4 blob.
    logProgress(`MP4 output exceeded target → continuing compression on MP4…`);
    inputBlob = outBlob;
  }

  // Normal iterative compression (also used for big files, or when MP4 forced output is too big)
  const maxRes = parseWH(UI.convertResSelect?.value || "1280x720");

  const [minResStr, minKbpsStr] = (
    UI.minQualitySelect?.value || "640x360|250"
  ).split("|");
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

  const fps = Number(UI.fpsSelect?.value) || 30;

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
    setText(UI.attemptText, String(attempt));
    setText(UI.progressText, "Encoding…");

    // reset progress bar each attempt
    if (UI.convBarFill) UI.convBarFill.style.width = "0%";
    setText(UI.convPctLabel, "0%");
    setText(UI.convEtaLabel, `Estimating… (Attempt ${attempt})`);
    convAttemptStartPerf = performance.now();
    convLastProgressUpdatePerf = 0;

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
        attempt,
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
      setText(UI.progressText, "Done");
      if (UI.convBarFill) UI.convBarFill.style.width = "100%";
      setText(UI.convPctLabel, "100%");
      setText(UI.convEtaLabel, "0s");
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
UI.convertBtn?.addEventListener("click", async () => {
  if (!sourceBlob) return;

  cancelRequested = false;
  setEnabled(UI.cancelConvertBtn, true);
  setEnabled(UI.convertBtn, false);

  try {
    clearResult();
    showProgress(true);
    logProgress(
      `Starting conversion… target ≤ ${fmtMB(MAX_BYTES - SAFETY_BYTES)}`,
    );

    const out = await compressIteratively(sourceBlob);

    showProgress(false);
    setEnabled(UI.cancelConvertBtn, false);
    cancelRequested = false;

    renderResult(out, "Final (≤ 50MB)");
  } catch (e) {
    showProgress(false);
    setEnabled(UI.cancelConvertBtn, false);

    const msg = e && e.message ? e.message : String(e);
    alert(msg);
    logProgress(`❌ Failed: ${msg}`);
  } finally {
    cancelRequested = false;
    updateConvertButtonState();
  }
});

UI.cancelConvertBtn?.addEventListener("click", () => {
  cancelRequested = true;
  setEnabled(UI.cancelConvertBtn, false);
  logProgress("Cancel requested…");
  setText(UI.progressText, "Cancelling…");
});

/********************************************************************
 * Enable/restart camera (gesture-required on iOS)
 ********************************************************************/
UI.enableCameraBtn?.addEventListener("click", async () => {
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

    if (
      UI.cameraSelect &&
      !UI.cameraSelect.value &&
      UI.cameraSelect.options[0]
    ) {
      UI.cameraSelect.value = UI.cameraSelect.options[0].value;
      lsSet(LS_KEYS.CAMERA_ID, UI.cameraSelect.value);
    }
    await startPreview();

    setEnabled(UI.restartPreviewBtn, true);
    setEnabled(UI.recordToggleBtn, true);

    setText(UI.cameraStateLabel, "Enabled");
  } catch (e) {
    console.error(e);
    alert(
      "Could not start camera. If you opened from Files on iPhone, host it on HTTPS.",
    );
  }
});

UI.restartPreviewBtn?.addEventListener("click", async () => {
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
UI.resetBtn?.addEventListener("click", () => {
  resetRecordingState();
  clearResult();
  sourceBlob = null;
  sourceLabel = "";
  updateConvertButtonState();
  setEnabled(UI.resetBtn, false);
});

/********************************************************************
 * Tabs
 ********************************************************************/
UI.tabRecord?.addEventListener("click", () => setMode("record"));
UI.tabUpload?.addEventListener("click", () => setMode("upload"));

/********************************************************************
 * Settings live updates + persist
 ********************************************************************/
UI.recordBitrate?.addEventListener("input", () => {
  setText(UI.recordBitrateLabel, UI.recordBitrate.value);
  lsSet(LS_KEYS.BITRATE_KBPS, UI.recordBitrate.value);
});
UI.convertResSelect?.addEventListener("change", () => {
  lsSet(LS_KEYS.CONVERT_RES, UI.convertResSelect.value);
});
UI.minQualitySelect?.addEventListener("change", () => {
  lsSet(LS_KEYS.MIN_QUALITY, UI.minQualitySelect.value);
});

/********************************************************************
 * Combo tab wiring (Video + Plot)
 ********************************************************************/
function wireComboButtons() {
  UI.comboEnableCameraBtn?.addEventListener("click", () =>
    UI.enableCameraBtn?.click(),
  );
  UI.comboRecordToggleBtn?.addEventListener("click", () =>
    UI.recordToggleBtn?.click(),
  );
  UI.comboPauseBtn?.addEventListener("click", () => UI.pauseBtn?.click());

  UI.comboStartPathBtn?.addEventListener("click", () =>
    MAP.startTrackBtn?.click(),
  );
  UI.comboDropPointBtn?.addEventListener("click", () =>
    MAP.dropPointBtn?.click(),
  );
  UI.comboCenterBtn?.addEventListener("click", () => MAP.mapCenterBtn?.click());
}

function syncComboUI() {
  if (UI.comboRecordToggleBtn && UI.recordToggleBtn) {
    UI.comboRecordToggleBtn.disabled = !!UI.recordToggleBtn.disabled;
    UI.comboRecordToggleBtn.textContent =
      UI.recordToggleBtn.textContent || "⏺️ Record";
    UI.comboRecordToggleBtn.className = UI.recordToggleBtn.className;
  }
  if (UI.comboPauseBtn && UI.pauseBtn) {
    UI.comboPauseBtn.disabled = !!UI.pauseBtn.disabled;
    UI.comboPauseBtn.textContent = UI.pauseBtn.textContent || "⏸️ Pause";
  }
  if (UI.comboEnableCameraBtn && UI.enableCameraBtn) {
    UI.comboEnableCameraBtn.disabled = !!UI.enableCameraBtn.disabled;
  }

  if (UI.comboStartPathBtn && MAP.startTrackBtn) {
    UI.comboStartPathBtn.textContent =
      MAP.startTrackBtn.textContent || "▶️ Start path";
    UI.comboStartPathBtn.disabled = !!MAP.startTrackBtn.disabled;
    UI.comboStartPathBtn.className = MAP.startTrackBtn.className;
  }
  if (UI.comboDropPointBtn && MAP.dropPointBtn) {
    UI.comboDropPointBtn.disabled = !!MAP.dropPointBtn.disabled;
  }
  if (UI.comboCenterBtn && MAP.mapCenterBtn) {
    UI.comboCenterBtn.disabled = !!MAP.mapCenterBtn.disabled;
  }
}

function updateComboHUD() {
  if (!UI.comboHudText) return;

  const cam = UI.cameraStateLabel ? UI.cameraStateLabel.textContent : "—";
  const rec = UI.recStateLabel ? UI.recStateLabel.textContent : "—";
  const t = UI.recTimeLabel ? UI.recTimeLabel.textContent : "";
  const sz = UI.recSizeLabel ? UI.recSizeLabel.textContent : "";

  UI.comboHudText.textContent = `Camera: ${cam} • Rec: ${rec} • ${t} • ${sz}`;
  if (UI.comboStateNote) UI.comboStateNote.textContent = rec;
}

/********************************************************************
 * Init (restore settings)
 ********************************************************************/
function restoreSettingsFromStorage() {
  const savedMode = lsGet(LS_KEYS.MODE, "record");
  mode = savedMode === "upload" ? "upload" : "record";

  const savedFps = lsGet(LS_KEYS.FPS, "");
  if (savedFps && UI.fpsSelect) UI.fpsSelect.value = savedFps;
  if (UI.fpsSelect && !UI.fpsSelect.value) UI.fpsSelect.value = "30";

  const savedPrevRes = lsGet(LS_KEYS.PREVIEW_RES, "");
  if (savedPrevRes && UI.previewResSelect)
    UI.previewResSelect.value = savedPrevRes;

  const savedConvRes = lsGet(LS_KEYS.CONVERT_RES, "");
  if (savedConvRes && UI.convertResSelect)
    UI.convertResSelect.value = savedConvRes;

  const savedBitrate = lsGet(LS_KEYS.BITRATE_KBPS, "");
  if (savedBitrate && UI.recordBitrate) UI.recordBitrate.value = savedBitrate;

  const savedMinQ = lsGet(LS_KEYS.MIN_QUALITY, "");
  if (savedMinQ && UI.minQualitySelect) UI.minQualitySelect.value = savedMinQ;

  if (UI.recordBitrateLabel && UI.recordBitrate) {
    UI.recordBitrateLabel.textContent = UI.recordBitrate.value;
  }

  setText(
    UI.cameraStateLabel,
    lsGetBool(LS_KEYS.AUTO_ENABLE_CAMERA, false) ? "Tap Enable" : "Not enabled",
  );
  setText(UI.recStateLabel, "Idle");
  setText(UI.convertStateLabel, "Ready");
}

function init() {
  setText(UI.limitLabel, fmtMB(MAX_BYTES));
  restoreSettingsFromStorage();

  show(UI.secureBanner, !isSecureEnoughForCamera());

  preferredOutputMime = pickPreferredOutputMime();
  updateOutputBadges();

  setMode(mode);
  updateRecUI();
  clearResult();

  setEnabled(UI.recordToggleBtn, false);
  setEnabled(UI.pauseBtn, false);
  setEnabled(UI.restartPreviewBtn, false);
  setEnabled(UI.resetBtn, false);

  // ensure progress UI exists
  if (UI.convBarFill) UI.convBarFill.style.width = "0%";
  setText(UI.convPctLabel, "—");
  setText(UI.convEtaLabel, "—");
}

init();

/********************************************************************
 * Combo tab wiring (Video + Plot)
 ********************************************************************/
try {
  wireComboButtons();
  setInterval(() => {
    syncComboUI();
    updateComboHUD();
  }, 250);
} catch (e) {
  // no-op
}
