// Keep persisted preferences separate from Vue so storage behavior can be tested
// without a browser, and old app settings can migrate safely.
export const SETTINGS_KEY = 'spv-capture-v2';

export const DEFAULT_SETTINGS = {
  targetMinutes: 5,
  resolution: '1280x720',
  fps: 30,
  cameraId: '',
  // Off by default for new visitors. An explicit camera enable remembers ON.
  autoOpenCamera: false,
  microphone: true,
  mode: 'auto', // auto or custom bitrate
  manualKbps: 1200,
  convertResolution: '854x480',
  dark: true,
  address: { street: '', city: '', region: '', postal: '', reference: '', notes: '' },
};

export function readLocalSettings(storage) {
  let saved = {};
  try {
    const raw = JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) saved = raw;
  } catch { /* Storage may be disabled or contain invalid old data. */ }
  const address = saved.address && typeof saved.address === 'object' && !Array.isArray(saved.address)
    ? saved.address : {};

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    // Do not interpret old non-boolean values as consent to auto-open.
    autoOpenCamera: saved.autoOpenCamera === true,
    address: { ...DEFAULT_SETTINGS.address, ...address },
  };
}

export function writeLocalSettings(storage, settings) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return !!storage;
  } catch { /* Browsers may block storage or run out of quota. */
    return false;
  }
}
