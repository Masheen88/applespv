import { reactive, watch } from 'vue';

const KEY = 'spv-capture-v2';
const DEFAULTS = {
  targetMinutes: 5,
  resolution: '1280x720',
  fps: 30,
  cameraId: '',
  microphone: true,
  mode: 'auto', // auto or custom bitrate
  manualKbps: 1200,
  convertResolution: '854x480',
  dark: true,
  address: { street: '', city: '', region: '', postal: '', reference: '', notes: '' },
};

export function useLocalSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* Storage can be disabled. */ }
  const settings = reactive({
    ...DEFAULTS,
    ...saved,
    address: { ...DEFAULTS.address, ...(saved.address || {}) },
  });

  // Deliberately store address locally, never upload it anywhere.
  watch(settings, () => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Ignore storage quota/private mode. */ }
  }, { deep: true });

  return settings;
}
