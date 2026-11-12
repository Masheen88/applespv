import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compressor = readFileSync(new URL('../src/composables/useCompressor.js', import.meta.url), 'utf8');

test('compressor invokes a single transcode with a precomputed plan', () => {
  assert.match(compressor, /createCompressionPlan\(sourceMeta, settings\)/);
  assert.match(compressor, /const output = await transcodeOnce\(/);
  assert.doesNotMatch(compressor, /MAX_COMPRESSION_PASSES|for\s*\(let n\s*=.*transcod/i);
});

test('cancel signal, progress states and timeouts protect stalled conversions', () => {
  assert.match(compressor, /controller\.abort\(\)/);
  assert.match(compressor, /stage\.value = 'finalizing'|phase: 'finalizing'/);
  assert.match(compressor, /stalledFor > 25_000/);
  assert.match(compressor, /Video processing stopped progressing/);
});

test('does not publish an output that misses the 50 MB limit', () => {
  assert.match(compressor, /output\.blob\.size > LIMIT_BYTES/);
  assert.match(compressor, /result\.value = output\.blob/);
});
