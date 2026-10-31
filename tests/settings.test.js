import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, readLocalSettings, SETTINGS_KEY, writeLocalSettings } from '../src/lib/localSettings.js';

// Exercise the same storage format used by an existing deployed app.
function memoryStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, value); },
  };
}

test('a new device starts with the camera off', () => {
  assert.equal(readLocalSettings(memoryStorage()).autoOpenCamera, false);
});

test('camera ON preference is remembered between app sessions', () => {
  const storage = memoryStorage();
  const settings = readLocalSettings(storage);
  settings.autoOpenCamera = true;
  assert.equal(writeLocalSettings(storage, settings), true);
  assert.equal(readLocalSettings(storage).autoOpenCamera, true);
  settings.autoOpenCamera = false;
  writeLocalSettings(storage, settings);
  assert.equal(readLocalSettings(storage).autoOpenCamera, false);
});

test('existing settings migrate without losing camera and address selections', () => {
  const storage = memoryStorage();
  storage.setItem(SETTINGS_KEY, JSON.stringify({
    cameraId: 'rear-phone-camera',
    resolution: '1920x1080',
    address: { city: 'Nashville' },
  }));
  const settings = readLocalSettings(storage);
  assert.equal(settings.autoOpenCamera, false);
  assert.equal(settings.cameraId, 'rear-phone-camera');
  assert.equal(settings.resolution, '1920x1080');
  assert.equal(settings.address.city, 'Nashville');
  assert.equal(settings.address.street, DEFAULT_SETTINGS.address.street);
});

test('broken storage or a non-boolean setting never enables camera implicitly', () => {
  const storage = memoryStorage();
  storage.setItem(SETTINGS_KEY, '{broken-json');
  assert.equal(readLocalSettings(storage).autoOpenCamera, false);
  storage.setItem(SETTINGS_KEY, JSON.stringify({ autoOpenCamera: 'true' }));
  assert.equal(readLocalSettings(storage).autoOpenCamera, false);
  assert.equal(readLocalSettings({ getItem() { throw Error('blocked'); } }).autoOpenCamera, false);
  assert.equal(writeLocalSettings({ setItem() { throw Error('blocked'); } }, {}), false);
});
