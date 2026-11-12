<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { X, Gauge, Camera, Settings2 } from 'lucide-vue-next';
import HelpTip from './HelpTip.vue';
import { formatBytes, estimateSizeBytes } from '../lib/media.js';

const props = defineProps({
  open: Boolean,
  settings: { type: Object, required: true },
  cameras: { type: Array, default: () => [] },
  recording: Boolean,
  effectiveKbps: { type: Number, required: true },
  cameraRunning: Boolean,
});
const emit = defineEmits(['close', 'apply']);
const estSize = computed(() => formatBytes(estimateSizeBytes(props.settings.targetMinutes * 60, props.effectiveKbps * 1000, props.settings.microphone)));
function handleKey(e) { if (e.key === 'Escape') emit('close'); }
onMounted(() => document.addEventListener('keydown', handleKey));
onBeforeUnmount(() => document.removeEventListener('keydown', handleKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex justify-end">
      <button type="button" class="absolute inset-0 bg-black/70 backdrop-blur-[3px]" aria-label="Close settings" @click="emit('close')" />
      <aside class="relative flex h-full w-full max-w-md flex-col border-l border-edge bg-panel shadow-soft" role="dialog" aria-modal="true" aria-label="Recording settings">
        <div class="flex items-center gap-2.5 border-b border-edge px-4 py-3.5">
          <Settings2 :size="20" class="text-mint" />
          <div class="flex-1"><h2 class="text-base font-bold text-white">Capture settings</h2><p class="text-xs text-slate-400">Saved on this device</p></div>
          <button type="button" class="icon-button" aria-label="Close settings" @click="emit('close')"><X :size="19" /></button>
        </div>

        <div class="flex-1 space-y-5 overflow-y-auto px-4 py-5 pb-10">
          <section class="space-y-3">
            <div class="flex items-center gap-2 text-slate-200 font-semibold text-sm"><Gauge :size="17" class="text-mint" /> Recording quality <HelpTip label="How the recording size estimate works" message="Auto mode picks a bitrate based on your planned duration. It does not stop or truncate a recording at 50 MB. Actual size may differ because mobile encoders can ignore bitrate requests. Oversized completed recordings can be compressed in one pass." /></div>
            <div class="grid grid-cols-2 gap-2">
              <label class="field col-span-2">Bitrate mode
                <select v-model="settings.mode" :disabled="recording">
                  <option value="auto">Auto by planned length</option>
                  <option value="custom">Manual bitrate</option>
                </select>
              </label>
              <label v-if="settings.mode === 'auto'" class="field col-span-2">Planned recording length (quality target)
                <select v-model.number="settings.targetMinutes" :disabled="recording">
                  <option :value="2">2 minutes · higher quality</option>
                  <option :value="5">5 minutes · balanced</option>
                  <option :value="10">10 minutes · compact</option>
                  <option :value="15">15 minutes · smaller files</option>
                  <option :value="20">20 minutes · very compact</option>
                  <option :value="30">30 minutes · lowest quality</option>
                </select>
              </label>
              <label v-else class="field col-span-2">Video bitrate · {{ settings.manualKbps }} kbps
                <input v-model.number="settings.manualKbps" type="range" min="160" max="6000" step="40" :disabled="recording" class="w-full accent-emerald-400" />
              </label>
            </div>
            <div class="rounded-xl border border-mint/20 bg-mint/5 px-3 py-2.5 text-xs text-slate-300">
              <p class="font-medium text-white">~{{ estSize }} / {{ settings.targetMinutes }} min <span class="text-slate-400">· {{ effectiveKbps }} kbps</span></p>
            </div>
          </section>

          <div class="h-px bg-edge" />
          <section class="space-y-3">
            <div class="flex items-center gap-2 text-slate-200 font-semibold text-sm"><Camera :size="17" class="text-mint" /> Camera and audio <HelpTip label="Camera permission and settings" message="Camera and microphone permissions belong to your browser. Settings apply when the camera restarts. Your camera ON/OFF preference is stored locally; iPhone Safari may still ask you to tap the preview." /></div>
            <label class="field">Camera
              <select v-model="settings.cameraId" :disabled="recording">
                <option value="">Prefer rear camera</option>
                <option v-for="(camera, index) in cameras" :key="camera.deviceId || index" :value="camera.deviceId">{{ camera.label || `Camera ${index + 1}` }}</option>
              </select>
            </label>
            <div class="grid grid-cols-2 gap-2.5">
              <label class="field">Camera resolution
                <select v-model="settings.resolution" :disabled="recording">
                  <option value="1920x1080">1080p</option><option value="1280x720">720p</option>
                  <option value="854x480">480p</option><option value="640x360">360p</option>
                </select>
              </label>
              <label class="field">Frame rate
                <select v-model.number="settings.fps" :disabled="recording">
                  <option :value="30">30 FPS</option><option :value="24">24 FPS</option><option :value="20">20 FPS</option><option :value="15">15 FPS</option>
                </select>
              </label>
            </div>
            <label class="flex items-center justify-between gap-2.5 rounded-xl border border-edge px-3 py-2.5 text-sm text-slate-300">
              Record microphone audio
              <input v-model="settings.microphone" type="checkbox" :disabled="recording" class="h-4 w-4 accent-emerald-400" />
            </label>
            <!-- Saved per browser; permission remains controlled by iOS/Android. -->
            <label class="flex items-center justify-between gap-2.5 rounded-xl border border-edge px-3 py-2.5 text-sm text-slate-300">
              <span class="min-w-0">
                <span class="block font-medium text-white">Open camera on next visit</span>

              </span>
              <input v-model="settings.autoOpenCamera" type="checkbox" class="h-4 w-4 shrink-0 accent-emerald-400" aria-label="Open camera automatically on future visits" />
            </label>

          </section>

          <div class="h-px bg-edge" />
          <section class="space-y-2">
            <div class="flex items-center gap-2"><h3 class="text-sm font-semibold text-white">Video compression</h3><HelpTip label="Single-pass video compression" message="This sets the maximum resolution, not a fixed output. The compressor automatically lowers resolution and frame rate for longer videos to target less than 50 MB in one pass. Keep the app open; converting a large video usually takes roughly as long as playing it. Strict size cannot be guaranteed if the browser ignores the bitrate." /></div>
            <label class="field">Maximum output resolution
              <select v-model="settings.convertResolution" :disabled="recording">
                <option value="1280x720">720p</option><option value="854x480">480p</option>
                <option value="640x360">360p</option><option value="426x240">240p</option>
              </select>
            </label>

          </section>
        </div>
        <div class="shrink-0 border-t border-edge bg-panel p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button type="button" class="button-primary w-full" :disabled="recording" @click="emit('apply')">{{ cameraRunning ? 'Apply & restart camera' : 'Apply settings' }}</button>
          <p v-if="recording" class="text-center text-xs text-slate-400 mt-2">Stop recording to change settings</p>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
