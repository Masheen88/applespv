import { reactive, watch } from 'vue';
import { readLocalSettings, writeLocalSettings } from '../lib/localSettings.js';

export function useLocalSettings() {
  let storage;
  try { storage = window.localStorage; } catch { /* Private or restricted browsing. */ }

  // Earlier saved preferences continue to work after a Netlify deployment.
  const settings = reactive(readLocalSettings(storage));

  // Deliberately store address + UI preferences locally, never upload them.
  watch(settings, () => {
    writeLocalSettings(storage, settings);
  }, { deep: true });

  return settings;
}
