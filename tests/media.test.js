import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMIT_BYTES, STOP_AT_BYTES, extensionForMime, estimateSizeBytes,
  formatBytes, formatDuration, pickRecordingMime, preferredMime, safeFileName,
  scaledDimensions, suggestedVideoBitrate,
} from '../src/lib/media.js';

test('uses a conservative decimal 50 MB limit and an early-stop buffer', () => {
  assert.equal(LIMIT_BYTES, 50_000_000);
  assert.ok(STOP_AT_BYTES < LIMIT_BYTES);
});
test('calculates smaller bitrate for longer planned recording', () => {
  assert.ok(suggestedVideoBitrate(5) > suggestedVideoBitrate(15));
  assert.ok(estimateSizeBytes(60, suggestedVideoBitrate(5)) < LIMIT_BYTES);
});
test('prefers MP4 if available, otherwise WebM', () => {
  assert.match(pickRecordingMime((mime) => mime === 'video/mp4'), /mp4/);
  assert.match(pickRecordingMime((mime) => mime === 'video/webm'), /webm/);
  assert.equal(pickRecordingMime(() => false), '');
});
test('does not incorrectly label unknown encodings as MP4', () => {
  assert.equal(extensionForMime('video/unknown'), 'video');
  assert.equal(extensionForMime('video/webm;codecs=vp8'), 'webm');
});
test('scales within maximum bounds and keeps encoder-safe even dimensions', () => {
  const { width, height } = scaledDimensions(1920, 1080, 854, 480);
  assert.ok(width <= 854 && height <= 480);
  assert.equal(width % 2, 0);
  assert.equal(height % 2, 0);
});
test('human-readable formatting and safe filenames', () => {
  assert.equal(formatBytes(1_500_000), '1.5 MB');
  assert.equal(formatDuration(135), '02:15');
  assert.equal(safeFileName(' My video / 02 '), 'My-video-02');
});

// Older WebKit builds do not expose isTypeSupported() even when MediaRecorder
// itself exists. Leave MIME selection to the native encoder in that case.
test('older iOS MediaRecorder without isTypeSupported does not crash', () => {
  const previous = globalThis.MediaRecorder;
  try {
    globalThis.MediaRecorder = class LegacyRecorder {};
    assert.equal(preferredMime(), '');
  } finally {
    if (previous === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = previous;
  }
});
