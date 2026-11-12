import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompressionPlan, SINGLE_PASS_TARGET_BYTES, MAX_OUTPUT_BYTES } from '../src/lib/compressionPlan.js';

const settings = { convertResolution: '1280x720', fps: 30 };

test('calculates a one-pass target safely beneath the hard limit', () => {
  const plan = createCompressionPlan({ duration: 600, width: 1920, height: 1080 }, settings);
  assert.equal(MAX_OUTPUT_BYTES, 50_000_000);
  assert.ok(SINGLE_PASS_TARGET_BYTES < MAX_OUTPUT_BYTES);
  assert.ok((plan.videoBps + plan.audioBps) * plan.duration / 8 <= SINGLE_PASS_TARGET_BYTES);
  assert.ok(plan.dimensions.width <= 1280 && plan.dimensions.height <= 720);
  assert.equal(plan.dimensions.width % 2, 0);
});

test('chooses smaller output dimensions and rate for a longer video', () => {
  const short = createCompressionPlan({ duration: 90, width: 1920, height: 1080 }, settings);
  const long = createCompressionPlan({ duration: 1200, width: 1920, height: 1080 }, settings);
  assert.ok(short.videoBps > long.videoBps);
  assert.ok(short.dimensions.width > long.dimensions.width);
  assert.ok(long.fps <= short.fps);
});

test('never upscales vertical source video or ignores the conversion preset', () => {
  const plan = createCompressionPlan({ duration: 240, width: 720, height: 1280 }, { convertResolution: '640x360', fps: 24 });
  assert.ok(plan.dimensions.width <= 720 && plan.dimensions.height <= 360);
  assert.ok(plan.dimensions.width < plan.dimensions.height);
});

test('rejects invalid duration and unrealistically lengthy clips', () => {
  assert.throws(() => createCompressionPlan({ duration: 0, width: 1280, height: 720 }), /duration/i);
  assert.throws(() => createCompressionPlan({ duration: 7200, width: 1280, height: 720 }), /too long/i);
});
