# 50 MB recording-cutoff fix

## Root cause

The recorder had two independent automatic cutoff paths:

1. `updateTime()` estimated encoded size from elapsed time and requested bitrate, then called `stopRecording()` around 46 MB when Safari had not emitted enough chunks yet.
2. `MediaRecorder.ondataavailable` accumulated emitted chunks and called `stopRecording()` once the measured bytes reached the same early-stop threshold.

This meant changing bitrate, resolution, or the planned duration could move the cutoff around, but the app was still intentionally ending the recording before 50 MB.

## New behavior

- Recording duration is no longer capped by the 50 MB upload target.
- The live byte meter is informational only.
- 50 MB is checked only after the user stops/finalizes the take.
- Oversized completed recordings are preserved in full.
- The result card exposes **Compress ≤ 50 MB** for oversized captures.
- Compression now gets up to six adaptive passes instead of three fixed reductions.
- Later passes adjust video bitrate, audio bitrate, and resolution based on the actual size miss.
- The original recording remains available even if the browser encoder still cannot reach 50 MB.

## Automatic stops that remain

The recorder can still stop when:

- the user presses Stop;
- Reset intentionally discards an active take;
- the camera track disconnects/ends; or
- `MediaRecorder` reports an encoder error.

There is no remaining byte-size or elapsed-time path that calls `stopRecording()`.

## Regression coverage

`tests/recorder-cutoff.test.js` verifies that:

- no `STOP_AT_BYTES` cutoff exists in the recorder;
- `ondataavailable` only accumulates chunks and cannot call `stopRecording()`; and
- `updateTime()` cannot call `stopRecording()`.
