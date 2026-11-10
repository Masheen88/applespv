import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const recorderSourceUrl = new URL('../src/composables/useRecorder.js', import.meta.url);

async function recorderSource() {
  return readFile(recorderSourceUrl, 'utf8');
}

test('live recording has no byte-limit stop constant', async () => {
  const source = await recorderSource();

  // The 50 MB value may be used for display/status, but there must not be a
  // STOP_AT_BYTES-style capture guard that can terminate a technician's take.
  assert.doesNotMatch(source, /STOP_AT_BYTES/);
  assert.doesNotMatch(source, /Stopped near 50 MB/i);
  assert.doesNotMatch(source, /estimated 46 MB/i);
});

test('ondataavailable only accumulates chunks and never stops for size', async () => {
  const source = await recorderSource();
  const start = source.indexOf('recorder.ondataavailable');
  const end = source.indexOf('recorder.onerror', start);

  assert.ok(start >= 0 && end > start, 'Could not locate recorder.ondataavailable block');
  const block = source.slice(start, end);

  assert.match(block, /parts\.push\(data\)/);
  assert.match(block, /bytes\.value \+= data\.size/);
  assert.doesNotMatch(block, /stopRecording\s*\(/);
});

test('elapsed-time updates cannot stop a recording at the output target', async () => {
  const source = await recorderSource();
  const start = source.indexOf('function updateTime()');
  const end = source.indexOf('async function listCameras()', start);

  assert.ok(start >= 0 && end > start, 'Could not locate updateTime block');
  const block = source.slice(start, end);

  assert.doesNotMatch(block, /stopRecording\s*\(/);
});
