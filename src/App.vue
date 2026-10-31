<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Aperture,
  Camera,
  CameraOff,
  CheckCircle,
  CircleAlert,
  Clock3,
  FileVideo2,
  Flashlight,
  FlashlightOff,
  FolderOpen,
  Info,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Square,
  Video,
  ZoomIn,
  Maximize2,
  Minimize2,
  X,
} from "lucide-vue-next";
import AddressCard from "./components/AddressCard.vue";
import ResultCard from "./components/ResultCard.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { useRecorder } from "./composables/useRecorder.js";
import { useCompressor } from "./composables/useCompressor.js";
import { useLocalSettings } from "./composables/useLocalSettings.js";
import {
  extensionForMime,
  formatBytes,
  formatDuration,
  LIMIT_BYTES,
  estimateSizeBytes,
} from "./lib/media.js";

const settings = useLocalSettings();
const capture = useRecorder(settings);
const compressor = useCompressor(settings);
const settingsOpen = ref(false);
const fileInput = ref(null);
const cameraPanel = ref(null);
const captureResultArea = ref(null);
const immersive = ref(false);
const pendingAction = ref(null); // 'reset' or 'replace' — confirmation protects unsaved footage.
const isFinalizing = computed(() => capture.status.value === "finalizing");
const hasTake = computed(
  () => recording.value || !!capture.result.value || capture.elapsed.value > 0,
);

// Use native ELEMENT fullscreen when it is offered (typically Android/iPad).
// iPhone Safari does not offer container fullscreen: a fixed viewport layout
// is the deliberate fallback so iOS doesn't replace our controls with the
// built-in video player (webkitEnterFullscreen would do exactly that).
async function toggleImmersive() {
  if (immersive.value) {
    immersive.value = false;
    if (document.fullscreenElement === cameraPanel.value) {
      try {
        await document.exitFullscreen();
      } catch {
        /* CSS fallback still exits. */
      }
    }
    return;
  }
  immersive.value = true;
  pendingAction.value = null;
  // Keep requestFullscreen inside the original user gesture (required by iOS/iPad/Android).
  if (document.fullscreenEnabled && cameraPanel.value?.requestFullscreen) {
    try {
      await cameraPanel.value.requestFullscreen({ navigationUI: "hide" });
    } catch {
      /* Leave immersive CSS mode on for iPhone or denied requests. */
    }
  }
}

function syncFullscreen() {
  // Browser/system fullscreen exit (Escape, system gesture) should also exit
  // immersive layout. Never force the user into a separate native video UI.
  if (immersive.value && !document.fullscreenElement && usedNativeFullscreen)
    immersive.value = false;
  usedNativeFullscreen = document.fullscreenElement === cameraPanel.value;
}
let usedNativeFullscreen = false;

async function reviewCapture() {
  if (immersive.value) await toggleImmersive();
  // Wait until the native fullscreen transition is complete, then expose the
  // existing save/share/result card without creating a second video player.
  await nextTick();
  captureResultArea.value?.scrollIntoView?.({
    behavior: "smooth",
    block: "start",
  });
}

function beginRecording() {
  if (!canStart.value) return;
  if (capture.result.value) {
    pendingAction.value = "replace";
    return;
  }
  capture.startRecording();
}
function askReset() {
  if (isFinalizing.value) return;
  if (hasTake.value) pendingAction.value = "reset";
  else capture.resetTake();
}
function confirmPendingAction() {
  const action = pendingAction.value;
  pendingAction.value = null;
  if (action === "reset") capture.resetTake();
  else if (action === "replace") {
    capture.resetTake();
    capture.startRecording();
  }
}
function onKeyDown(event) {
  if (event.key === "Escape" && pendingAction.value) {
    pendingAction.value = null;
  } else if (
    event.key === "Escape" &&
    immersive.value &&
    !document.fullscreenElement
  ) {
    void toggleImmersive();
  }
}

const selectedFilename = computed(
  () => compressor.file.value?.name || "No file selected",
);
const cameraEnabled = computed(() => !!capture.cameraStream.value);
const recording = capture.recording;
const estimatedBytes = computed(() =>
  estimateSizeBytes(
    capture.elapsed.value,
    capture.videoBps.value,
    capture.hasAudio.value,
  ),
);
const statusText = computed(
  () =>
    ({
      idle: "Camera off",
      loading: "Opening camera…",
      ready: "Camera ready",
      recording: "Recording + encoding",
      paused: "Paused",
      finalizing: "Finalizing video…",
    })[capture.status.value] || "Ready",
);
const statusColor = computed(() =>
  capture.status.value === "recording"
    ? "text-red-300"
    : capture.status.value === "ready"
      ? "text-mint"
      : "text-slate-400",
);
const canStart = computed(
  () => cameraEnabled.value && capture.status.value === "ready",
);
const liveFileFormat = computed(() =>
  extensionForMime(capture.mime.value).toUpperCase(),
);

// The preference records the user's camera ON/OFF choice, not browser permission.
// Browsers retain control over camera access; a stored preference cannot bypass a
// permission prompt, iOS restrictions, or a paused camera after screen locking.
async function openCamera() {
  await capture.enableCamera();
  // Only remember ON after a camera stream actually opens successfully.
  // Permission-denied attempts must not silently become a persistent ON state.
  if (capture.cameraStream.value) settings.autoOpenCamera = true;
}

function closeCamera() {
  // Turning the preview OFF is an explicit choice that survives a reload.
  capture.shutCamera();
  settings.autoOpenCamera = false;
}

onMounted(() => {
  // The video element is mounted before we request a live stream. An automatic
  // request might still be blocked or require a user tap (especially on iOS).
  // Never start a recording just because the technician reopened the app.
  if (settings.autoOpenCamera && capture.supported && capture.secure) {
    void capture.enableCamera();
  }
});

async function applySettings() {
  settingsOpen.value = false;
  if (cameraEnabled.value && !recording.value) await capture.enableCamera();
}
function pickUpload() {
  fileInput.value?.click();
}
async function onFileChange(event) {
  const selected = event.target.files?.[0] || null;
  await compressor.selectFile(selected);
  if (event.target) event.target.value = ""; // Allow selecting the same file again.
}
async function recompressCapture() {
  if (!capture.result.value) return;
  // A recorded file can be sent directly into the same local conversion pipeline.
  await compressor.convert(capture.result.value, { force: true });
}
function clearCompressor() {
  if (compressor.busy.value) return;
  compressor.selectFile(null);
}

// Prevent accidental tab-close while capturing; Android may still suspend the
// camera when another app takes exclusive access in split-screen mode.
function beforeUnload(event) {
  if (capture.recording.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
window.addEventListener("keydown", onKeyDown);
document.addEventListener("fullscreenchange", syncFullscreen);
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", beforeUnload);
  window.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("fullscreenchange", syncFullscreen);
  // Never leave a native fullscreen element behind after route teardown.
  if (document.fullscreenElement === cameraPanel.value)
    document.exitFullscreen().catch(() => {});
});
</script>

<template>
  <div class="min-h-[100dvh] text-slate-100 app-root">
    <header class="app-header">
      <div
        class="flex justify-between items-center gap-2 mx-auto px-3 sm:px-5 py-2.5 w-full max-w-6xl"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="bg-mint/10 p-2 rounded-xl text-mint shrink-0">
            <Aperture :size="22" />
          </div>
          <div class="min-w-0">
            <h1
              class="font-bold text-white text-sm sm:text-base leading-tight tracking-tight"
            >
              <span class="text-mint"> AEPMS Video </span>
            </h1>
            <p class="text-[11px] text-slate-400 truncate">
              Mobile video recorder &amp; compressor
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span
            class="px-2 py-1 border border-edge rounded-full tabular-nums text-[11px] text-slate-300"
            >50 MB target</span
          >
          <button
            type="button"
            class="icon-button"
            title="Settings"
            aria-label="Open settings"
            @click="settingsOpen = true"
          >
            <Settings2 :size="19" />
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto px-3 sm:px-5 pt-3 sm:pt-5 pb-10 w-full max-w-6xl">
      <div class="workspace-grid">
        <div class="space-y-3 min-w-0">
          <!-- One preview element stays mounted across normal/immersive modes.
               Moving a live stream between <video> nodes can stop iOS playback. -->
          <section
            ref="cameraPanel"
            class="bg-panel shadow-soft border border-edge rounded-2xl overflow-hidden camera-primary"
            :class="{ 'camera-immersive': immersive }"
            aria-label="Live camera and recording controls"
          >
            <div
              class="flex justify-between items-center gap-2 px-3.5 py-2.5 camera-panel-heading"
            >
              <div class="flex items-center gap-2 min-w-0">
                <Video :size="16" class="text-mint" />
                <h2 class="font-semibold text-white text-sm">Live camera</h2>
              </div>
              <div
                class="flex items-center gap-1.5 text-[11px]"
                :class="statusColor"
              >
                <span
                  :class="[
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    capture.status.value === 'recording'
                      ? 'bg-red-400 animate-pulse'
                      : cameraEnabled
                        ? 'bg-mint'
                        : 'bg-slate-500',
                  ]"
                />{{ statusText }}
              </div>
            </div>

            <div class="camera-wrap">
              <div class="camera-frame">
                <!-- playsinline and webkit-playsinline keep the LIVE stream inline
                     on iPhone, so our overlay remains interactive. -->
                <video
                  :ref="
                    (element) => {
                      capture.previewEl.value = element;
                    }
                  "
                  class="camera-video"
                  autoplay
                  muted
                  playsinline
                  webkit-playsinline
                  disablepictureinpicture
                />
                <div
                  v-if="!cameraEnabled"
                  class="absolute inset-0 flex flex-col justify-center items-center gap-3 bg-gradient-to-br from-[#162337] to-[#0a121f] px-4 text-center"
                  style="padding-bottom: 54px"
                >
                  <div class="bg-white/5 p-3 border border-edge rounded-2xl">
                    <Camera :size="28" class="text-mint" />
                  </div>
                  <div>
                    <p class="font-semibold text-white text-sm">
                      Camera preview
                    </p>
                    <p class="mt-1 max-w-xs text-slate-400 text-xs">
                      Enable your camera to record a compressed video.
                    </p>
                  </div>
                  <p v-if="!capture.secure" class="text-[11px] text-amber-200">
                    Camera requires HTTPS or localhost.
                  </p>
                  <p
                    v-if="!capture.supported"
                    class="text-[11px] text-amber-200"
                  >
                    Use a modern Safari/Chrome browser with camera and
                    MediaRecorder support.
                  </p>
                  <p
                    v-if="capture.error.value"
                    class="max-w-xs text-[11px] text-amber-200 leading-snug"
                    role="alert"
                  >
                    {{ capture.error.value }}
                  </p>
                  <button
                    type="button"
                    class="button-primary"
                    :disabled="
                      capture.status.value === 'loading' ||
                      !capture.supported ||
                      !capture.secure
                    "
                    @click="openCamera"
                  >
                    <LoaderCircle
                      v-if="capture.status.value === 'loading'"
                      :size="16"
                      class="animate-spin"
                    /><Camera v-else :size="16" /> Enable camera
                  </button>
                </div>

                <!-- A few iOS versions require a second direct user gesture
                     even after getUserMedia granted access to the camera. -->
                <div
                  v-if="cameraEnabled && capture.previewNeedsGesture.value"
                  class="z-[4] absolute inset-0 flex justify-center items-center pointer-events-none"
                >
                  <button
                    type="button"
                    class="pointer-events-auto button-primary"
                    @click="capture.resumePreview"
                  >
                    <Play :size="16" /> Show camera preview
                  </button>
                </div>
                <!-- Status and fullscreen toggle are OVER the video on both phones. -->
                <div class="camera-top-hud">
                  <div
                    class="camera-status"
                    :class="
                      capture.status.value === 'recording'
                        ? 'camera-status--active'
                        : ''
                    "
                  >
                    <span
                      class="rounded-full w-2 h-2 shrink-0"
                      :class="
                        capture.status.value === 'recording'
                          ? 'bg-red-400 animate-pulse'
                          : capture.status.value === 'paused'
                            ? 'bg-amber-300'
                            : 'bg-mint'
                      "
                    />
                    <span>{{
                      capture.status.value === "recording"
                        ? "REC"
                        : capture.status.value === "paused"
                          ? "PAUSED"
                          : capture.status.value === "finalizing"
                            ? "SAVING…"
                            : capture.status.value === "loading"
                              ? "OPENING…"
                              : cameraEnabled
                                ? "READY"
                                : "OFF"
                    }}</span>
                    <span v-if="cameraEnabled" class="tabular-nums">{{
                      formatDuration(capture.elapsed.value)
                    }}</span>
                    <span v-if="recording" class="tabular-nums text-slate-300"
                      >· {{ formatBytes(capture.bytes.value) }}</span
                    >
                  </div>
                  <button
                    type="button"
                    class="camera-fullscreen-button"
                    :aria-label="
                      immersive
                        ? 'Exit full-screen camera'
                        : 'Expand camera to full screen'
                    "
                    :title="
                      immersive ? 'Exit full screen' : 'Full-screen camera'
                    "
                    :aria-pressed="immersive"
                    @click="toggleImmersive"
                  >
                    <Minimize2 v-if="immersive" :size="21" /><Maximize2
                      v-else
                      :size="21"
                    />
                  </button>
                </div>
                <div
                  v-if="capture.result.value && !recording && !isFinalizing"
                  class="camera-result-callout"
                >
                  <span class="tabular-nums"
                    >Take ready ·
                    {{ formatBytes(capture.result.value.size) }}</span
                  >
                  <button
                    type="button"
                    class="camera-result-link"
                    @click="reviewCapture"
                  >
                    Review &amp; save
                  </button>
                </div>
                <div
                  v-if="
                    capture.error.value || (immersive && capture.hint.value)
                  "
                  class="camera-inline-feedback"
                  role="status"
                >
                  {{ capture.error.value || capture.hint.value }}
                </div>

                <!-- Large thumb targets, never the browser's native player controls. -->
                <div
                  class="camera-control-dock"
                  role="group"
                  aria-label="Video recording controls"
                >
                  <button
                    type="button"
                    class="camera-action"
                    :disabled="!canStart"
                    aria-label="Record video"
                    title="Record"
                    @click="beginRecording"
                  >
                    <span class="camera-action-glyph camera-action-record"
                      ><span class="bg-red-500 rounded-full w-[18px] h-[18px]"
                    /></span>
                    <span class="camera-action-label">Record</span>
                  </button>
                  <button
                    type="button"
                    class="camera-action"
                    :disabled="!recording"
                    :aria-label="
                      capture.status.value === 'paused'
                        ? 'Resume recording'
                        : 'Pause recording'
                    "
                    :title="
                      capture.status.value === 'paused' ? 'Resume' : 'Pause'
                    "
                    @click="capture.togglePause"
                  >
                    <span class="camera-action-glyph"
                      ><Play
                        v-if="capture.status.value === 'paused'"
                        :size="23"
                        fill="currentColor" /><Pause
                        v-else
                        :size="23"
                        fill="currentColor"
                    /></span>
                    <span class="camera-action-label">{{
                      capture.status.value === "paused" ? "Resume" : "Pause"
                    }}</span>
                  </button>
                  <button
                    type="button"
                    class="camera-action"
                    :disabled="!recording"
                    aria-label="Stop and save recording"
                    title="Stop"
                    @click="capture.stopRecording()"
                  >
                    <span class="camera-action-glyph camera-action-stop"
                      ><Square :size="19" fill="currentColor"
                    /></span>
                    <span class="camera-action-label">Stop</span>
                  </button>
                  <button
                    type="button"
                    class="camera-action"
                    :disabled="isFinalizing || !hasTake"
                    aria-label="Reset and discard recording"
                    title="Reset recording"
                    @click="askReset"
                  >
                    <span class="camera-action-glyph"
                      ><RotateCcw :size="23"
                    /></span>
                    <span class="camera-action-label">Reset</span>
                  </button>
                </div>

                <!-- Reset/re-record confirmation is INSIDE the camera container so
                     it remains visible even when native element fullscreen is active. -->
                <div
                  v-if="pendingAction"
                  class="camera-confirm-backdrop"
                  role="presentation"
                >
                  <div
                    class="camera-confirm-dialog"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="take-dialog-title"
                    aria-describedby="take-dialog-description"
                  >
                    <div class="flex justify-between items-center gap-3">
                      <h3
                        id="take-dialog-title"
                        class="font-bold text-white text-sm"
                      >
                        {{
                          pendingAction === "reset"
                            ? "Discard this take?"
                            : "Start a new take?"
                        }}
                      </h3>
                      <button
                        class="icon-button"
                        type="button"
                        aria-label="Cancel"
                        @click="pendingAction = null"
                      >
                        <X :size="18" />
                      </button>
                    </div>
                    <p
                      id="take-dialog-description"
                      class="mt-2 text-slate-300 text-xs leading-relaxed"
                    >
                      {{
                        pendingAction === "reset"
                          ? "The current recording will be discarded. Save it first if you need to keep it."
                          : "Your previous unsaved recording will be replaced. Save or share it first if you need it."
                      }}
                    </p>
                    <div class="flex justify-end gap-2 mt-4">
                      <button
                        type="button"
                        class="button-secondary"
                        @click="pendingAction = null"
                      >
                        Cancel</button
                      ><button
                        type="button"
                        class="!bg-red-400 !text-black button-primary"
                        @click="confirmPendingAction"
                      >
                        {{
                          pendingAction === "reset"
                            ? "Discard take"
                            : "Start new take"
                        }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="px-3.5 pt-3 pb-3.5 camera-metrics">
              <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="chip"
                  ><Clock3 :size="13" />
                  {{ formatDuration(capture.elapsed.value) }}</span
                >
                <span class="chip"
                  ><FileVideo2 :size="13" />
                  {{ formatBytes(capture.bytes.value) }}</span
                >
                <span class="chip"
                  >{{ liveFileFormat }} ·
                  {{ Math.round(capture.videoBps.value / 1000) }} kbps</span
                >
                <span v-if="cameraEnabled" class="chip">{{
                  capture.hasAudio.value ? "Mic on" : "No mic"
                }}</span>
              </div>
              <div
                class="bg-slate-700/70 rounded-full w-full h-1.5 overflow-hidden"
                role="progressbar"
                :aria-valuenow="capture.progress.value"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="Current recording size as percent of 50 MB"
              >
                <div
                  :class="[
                    'h-full transition-[width] duration-500',
                    capture.bytes.value > LIMIT_BYTES
                      ? 'bg-red-400'
                      : 'bg-mint',
                  ]"
                  :style="{ width: capture.progress.value + '%' }"
                />
              </div>
              <p class="mt-1.5 text-[11px] text-slate-500">
                Compressed as you record · early stop around 46 MB
                <span v-if="recording"
                  >· ~{{ formatBytes(estimatedBytes) }} estimated</span
                >
              </p>
            </div>
          </section>

          <!-- Address is not part of a hidden tab and never replaces the camera. -->
          <AddressCard :address="settings.address" />

          <!-- Camera options stay outside the immersive preview. The four
               primary record actions live directly on top of the live video. -->
          <section class="card-surface" aria-label="Additional camera options">
            <div class="flex justify-between items-center mb-2">
              <h2 class="font-bold text-white text-sm">Camera options</h2>
              <!-- <span class="text-[11px] text-slate-400"
                >Record · Pause · Stop · Reset above</span
              > -->
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                class="button-quiet"
                type="button"
                :disabled="recording || isFinalizing"
                @click="openCamera"
              >
                <RotateCcw :size="15" />{{
                  cameraEnabled ? "Restart camera" : "Open camera"
                }}
              </button>
              <button
                v-if="cameraEnabled"
                class="button-quiet"
                type="button"
                :disabled="recording || isFinalizing"
                @click="closeCamera"
              >
                <CameraOff :size="15" /> Off
              </button>
              <button
                v-if="capture.torchAvailable.value"
                class="button-quiet"
                type="button"
                @click="capture.toggleTorch"
              >
                <Flashlight
                  v-if="capture.torchOn.value"
                  :size="15"
                /><FlashlightOff v-else :size="15" />{{
                  capture.torchOn.value ? "Torch on" : "Torch off"
                }}
              </button>
            </div>

            <label
              v-if="capture.zoomRange.value"
              class="flex items-center gap-2 mt-3 text-slate-400 text-xs"
              ><ZoomIn :size="15" class="shrink-0" /><span class="min-w-9"
                >{{ capture.zoom.value.toFixed(1) }}x</span
              ><input
                type="range"
                class="flex-1 accent-emerald-400"
                :min="capture.zoomRange.value.min"
                :max="capture.zoomRange.value.max"
                :step="capture.zoomRange.value.step || 0.1"
                :value="capture.zoom.value"
                @input="capture.setZoom($event.target.value)"
            /></label>
            <p
              v-if="capture.error.value"
              class="mt-3 feedback-error"
              role="alert"
            >
              <CircleAlert :size="16" class="shrink-0" />{{
                capture.error.value
              }}
            </p>
            <p
              v-if="capture.hint.value"
              class="mt-3 feedback-note"
              role="status"
            >
              <Info :size="16" class="shrink-0" />{{ capture.hint.value }}
            </p>
          </section>

          <div ref="captureResultArea">
            <ResultCard
              :blob="capture.result.value"
              label="spv-capture"
              :notice="
                capture.result.value && capture.result.value.size <= LIMIT_BYTES
                  ? 'The recording was already encoded during capture. No second compression pass needed.'
                  : ''
              "
              @recompress="recompressCapture"
              @discard="capture.discardResult"
            />
          </div>
        </div>

        <aside class="space-y-3 min-w-0">
          <section v-if="liveFileFormat !== 'MP4'" class="card-surface">
            <div class="flex items-center gap-2 mb-2">
              <CheckCircle :size="18" class="text-mint" />
              <h2 class="font-semibold text-white text-sm">
                Ready for your workflow
              </h2>
            </div>
            <p class="text-slate-400 text-xs leading-relaxed">
              Camera recording is encoded at the chosen bitrate as it happens.
              Stop recording and the file is already compressed and ready to
              save.
            </p>
            <div class="flex flex-wrap gap-2 mt-3">
              <span class="chip">On-device</span
              ><span class="chip">No maps</span
              ><span class="chip">50 MB guard</span>
            </div>
            <div
              v-if="liveFileFormat !== 'MP4'"
              class="mt-3 text-amber-200 feedback-note"
            >
              <Info :size="15" class="shrink-0" />{{
                liveFileFormat === "VIDEO"
                  ? "Format will be confirmed when the camera opens."
                  : `This browser prefers ${liveFileFormat}. MP4 is not supported for live encoding on this device.`
              }}
            </div>
          </section>

          <section class="card-surface" aria-label="Uploaded file compression">
            <div class="flex justify-between items-start gap-2 mb-2">
              <div>
                <h2 class="font-bold text-white text-sm">
                  Compress an existing video
                </h2>
                <p class="mt-0.5 text-slate-400 text-xs">
                  MP4, MOV, WebM or another supported format
                </p>
              </div>
              <div class="bg-white/5 p-2 rounded-xl text-slate-300">
                <FolderOpen :size="19" />
              </div>
            </div>
            <label for="file-input" class="sr-only">Choose a video file</label>
            <input
              id="file-input"
              ref="fileInput"
              class="sr-only"
              type="file"
              accept="video/*,.mov,.mp4,.webm,.m4v,.mkv"
              @change="onFileChange"
            />
            <button
              class="mt-2 w-full button-secondary"
              type="button"
              :disabled="compressor.busy.value"
              @click="pickUpload"
            >
              <FileVideo2 :size="16" /> Choose video file
            </button>
            <div v-if="compressor.file.value" class="space-y-2 mt-3">
              <div
                class="bg-white/[.03] px-3 py-2.5 border border-edge rounded-xl"
              >
                <p class="font-semibold text-white text-xs truncate">
                  {{ selectedFilename }}
                </p>
                <p class="mt-1 text-[11px] text-slate-400">
                  {{ formatBytes(compressor.file.value.size)
                  }}<template v-if="compressor.metadata.value">
                    · {{ formatDuration(compressor.metadata.value.duration) }} ·
                    {{ compressor.metadata.value.width }}×{{
                      compressor.metadata.value.height
                    }}</template
                  >
                </p>
              </div>

              <!--  -->
              <video
                v-if="compressor.previewUrl.value"
                :src="compressor.previewUrl.value"
                class="bg-black rounded-xl w-full max-h-44"
                controls
                playsinline
                preload="metadata"
              />
              <button
                type="button"
                class="w-full button-primary"
                :disabled="
                  compressor.busy.value ||
                  !compressor.metadata.value ||
                  recording
                "
                @click="compressor.convert()"
              >
                <LoaderCircle
                  v-if="compressor.busy.value"
                  :size="17"
                  class="animate-spin"
                /><Aperture v-else :size="16" />{{
                  compressor.busy.value
                    ? `Converting · pass ${compressor.attempt.value}`
                    : "Compress / prepare ≤ 50 MB"
                }}
              </button>
            </div>
            <p
              v-if="recording && compressor.file.value"
              class="mt-2 text-[11px] text-slate-400"
            >
              Stop recording before re-encoding a separate file.
            </p>
            <div v-if="compressor.busy.value" class="mt-3">
              <div class="flex justify-between mb-2 text-slate-400 text-xs">
                <span>Conversion pass {{ compressor.attempt.value }} of 3</span
                ><span>{{ compressor.progress.value }}%</span>
              </div>
              <div class="bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-mint h-full transition-[width] duration-300"
                  :style="{ width: compressor.progress.value + '%' }"
                />
              </div>
              <button
                class="mt-2 button-quiet"
                type="button"
                @click="compressor.cancel"
              >
                Cancel conversion
              </button>
            </div>
            <p
              v-if="compressor.error.value"
              class="mt-3 feedback-error"
              role="alert"
            >
              <CircleAlert :size="16" class="shrink-0" />{{
                compressor.error.value
              }}
            </p>
            <p
              v-if="compressor.notice.value"
              class="mt-3 feedback-note"
              role="status"
            >
              <Info :size="16" class="shrink-0" />{{ compressor.notice.value }}
            </p>
            <p
              v-if="!compressor.file.value && !compressor.busy.value"
              class="mt-3 text-slate-500 text-xs leading-relaxed"
            >
              Use this only for videos you already have or recordings that
              exceed the limit. Conversion runs in real time and stays on your
              device.
            </p>
            <button
              v-if="compressor.file.value && !compressor.busy.value"
              class="mt-1 button-quiet"
              type="button"
              @click="clearCompressor"
            >
              Clear selected file
            </button>
          </section>
          <ResultCard
            :blob="compressor.result.value"
            label="spv-compressed"
            :notice="compressor.notice.value"
            @discard="compressor.result.value = null"
            @recompress="
              compressor.convert(compressor.result.value, { force: true })
            "
          />
        </aside>
      </div>
    </main>

    <SettingsPanel
      :open="settingsOpen"
      :settings="settings"
      :cameras="capture.cameras.value"
      :recording="recording"
      :camera-running="cameraEnabled"
      :effective-kbps="Math.round(capture.videoBps.value / 1000)"
      @close="settingsOpen = false"
      @apply="applySettings"
    />
  </div>
</template>
