<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CheckCircle2, Download, Share2, AlertTriangle, Play, RotateCcw } from 'lucide-vue-next';
import { extensionForMime, formatBytes, LIMIT_BYTES, safeFileName } from '../lib/media.js';

const props = defineProps({ blob: { type: Blob, default: null }, label: { type: String, default: 'capture' }, notice: { type: String, default: '' } });
const emit = defineEmits(['recompress', 'discard']);
const videoUrl = ref('');
const openPreview = ref(false);
const shareError = ref('');
const underLimit = computed(() => !!props.blob && props.blob.size <= LIMIT_BYTES);
const ext = computed(() => extensionForMime(props.blob?.type));
const filename = computed(() => `${safeFileName(props.label)}-${new Date().toISOString().slice(0, 10)}.${ext.value}`);

watch(() => props.blob, (blob) => {
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
  videoUrl.value = blob ? URL.createObjectURL(blob) : '';
  openPreview.value = false;
  shareError.value = '';
}, { immediate: true });
onBeforeUnmount(() => { if (videoUrl.value) URL.revokeObjectURL(videoUrl.value); });

function save() {
  if (!videoUrl.value) return;
  // A temporary anchor is more reliable than opening Blob URLs on Android.
  const anchor = document.createElement('a');
  anchor.href = videoUrl.value;
  anchor.download = filename.value;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function share() {
  if (!props.blob) return;
  try {
    const file = new File([props.blob], filename.value, { type: props.blob.type });
    // iOS Safari/PWA handles Save to Files and Photos through the native share
    // sheet more consistently than an anchor[download]. Prefer it when possible.
    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) { save(); return; }
    await navigator.share({ files: [file], title: filename.value });
  } catch (cause) {
    if (cause?.name !== 'AbortError') shareError.value = `Share failed: ${cause?.message || 'unknown error'}`;
  }
}
</script>

<template>
  <section v-if="blob" class="card-surface" aria-label="Video result">
    <div class="flex items-start gap-3">
      <div :class="['rounded-xl p-2', underLimit ? 'bg-mint/10 text-mint' : 'bg-amber-400/10 text-amber-300']">
        <CheckCircle2 v-if="underLimit" :size="21" /><AlertTriangle v-else :size="21" />
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-sm font-semibold text-white">{{ underLimit ? 'Video ready to save' : 'Video exceeds 50 MB' }}</h3>
        <p class="mt-1 text-xs text-slate-400">{{ formatBytes(blob.size) }} · {{ ext.toUpperCase() }} · {{ underLimit ? 'Within 50 MB' : 'Compression required' }}</p>
        <p v-if="notice" class="mt-1.5 text-xs text-slate-400">{{ notice }}</p>
        <p v-if="ext !== 'mp4'" class="mt-1.5 text-xs text-amber-200">This browser encoded {{ ext.toUpperCase() }}, not MP4. Services requiring MP4 may reject it.</p>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2 mt-3">
      <button type="button" class="button-primary" @click="save"><Download :size="16" /> Save</button>
      <button type="button" class="button-secondary" @click="share"><Share2 :size="16" /> Share</button>
      <button type="button" class="button-secondary" @click="openPreview = !openPreview"><Play :size="16" /> {{ openPreview ? 'Hide' : 'Review' }}</button>
      <button v-if="!underLimit" type="button" class="button-secondary" @click="emit('recompress')"><RotateCcw :size="16" /> Compress</button>
      <button v-else type="button" class="button-quiet" @click="emit('discard')">Clear result</button>
    </div>
    <video v-if="openPreview" :src="videoUrl" controls playsinline class="w-full mt-3 rounded-xl bg-black max-h-56" />
    <p v-if="shareError" role="alert" class="text-xs text-amber-300 mt-2">{{ shareError }}</p>
  </section>
</template>
