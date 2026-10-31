<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { X, Info, Gauge, Camera, Settings2 } from 'lucide-vue-next';
import { estimatedMinutes, formatBytes, estimateSizeBytes, suggestedVideoBitrate } from '../lib/media.js';

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
const estMinutes = computed(() => estimatedMinutes(props.effectiveKbps * 1000, props.settings.microphone).toFixed(1));
const autoKbps = computed(() => Math.round(suggestedVideoBitrate(props.settings.targetMinutes, props.settings.microphone) / 1000));
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
            <div class="flex items-center gap-2 text-slate-200 font-semibold text-sm"><Gauge :size="17" class="text-mint" /> Compression during recording</div>
            <div class="grid grid-cols-2 gap-2">
              <label class="field col-span-2">Bitrate mode
                <select v-model="settings.mode" :disabled="recording">
                  <option value="auto">Auto by desired length</option>
                  <option value="custom">Manual bitrate</option>
                </select>
              </label>
              <label v-if="settings.mode === 'auto'" class="field col-span-2">Planned recording length
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
            <div class="rounded-xl border border-mint/20 bg-mint/5 p-3 text-xs text-slate-300 space-y-1">
              <p><span class="text-white font-semibold">Encoder target:</span> {{ effectiveKbps }} kbps video <span v-if="settings.mode === 'auto'" class="text-slate-400">(auto: {{ autoKbps }})</span></p>
              <p><span class="text-white font-semibold">Estimate:</span> {{ estSize }} for {{ settings.targetMinutes }} min · ~{{ estMinutes }} min to safety limit at that average rate</p>
              <p class="text-slate-400">The browser controls actual encoding. A measured-size safety stop is also used.</p>
            </div>
          </section>

          <div class="h-px bg-edge" />
          <section class="space-y-3">
            <div class="flex items-center gap-2 text-slate-200 font-semibold text-sm"><Camera :size="17" class="text-mint" /> Camera and audio</div>
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
            <p class="flex gap-2 text-xs leading-relaxed text-slate-400"><Info :size="15" class="shrink-0 mt-0.5" /> Changes to camera/audio/resolution take effect after restarting the preview. Recording settings are locked while capturing.</p>
          </section>

          <div class="h-px bg-edge" />
          <section class="space-y-2">
            <h3 class="text-sm font-semibold text-white">Upload conversion</h3>
            <label class="field">Maximum output resolution
              <select v-model="settings.convertResolution" :disabled="recording">
                <option value="1280x720">720p</option><option value="854x480">480p</option>
                <option value="640x360">360p</option><option value="426x240">240p</option>
              </select>
            </label>
            <p class="text-xs leading-relaxed text-slate-400">Uploaded videos are re-encoded at playback speed. Captured videos are compressed as they record and generally do not need this step.</p>
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
