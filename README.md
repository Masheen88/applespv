# AEPMS Video Studio — Vue 3 + Vite + Tailwind

Mobile-first rewrite of the uploaded AppleSPV web application. The old Leaflet, drawing, combination mode, and map export code have been removed. This rewrite keeps camera capture and video compression, while consolidating everything into one responsive workspace. Relevant original code comments and algorithm explanations have been carried forward into the corresponding modules; comments for deleted map functionality are intentionally excluded.

## Requirements

- Node.js 20 or newer.
- Modern Android Chrome or iPhone Safari (iOS 14.3+ supporting MediaRecorder) and **HTTPS** to access the camera remotely. `http://localhost` is permitted for local development, but an HTTP LAN IP generally is **not**.
- **MP4 requires browser MP4 encoding support.** Chrome on some Android versions may only produce WebM. Renaming a file `.mp4` does not change its codec/container. This project never makes that claim.

## Get started (Windows 11 CMD)

```bat
npm install
npm run dev
```

Open the Vite URL on your computer. To use the **phone camera** from another machine, deploy the site to HTTPS or use an HTTPS development tunnel. Merely visiting `http://192.168.x.x:5173` is usually not a secure context.

```bat
npm test
npm run build
npm run preview
```

You can also double-click `start.cmd` or `build.cmd` on Windows. With pnpm installed, use `pnpm install`, `pnpm dev`, and `pnpm build` instead.

`dist/` is a static deployable site — no backend, database, API keys, or maps are required. The root `netlify.toml` configures the existing Netlify site to run `npm run build` and publish `dist/`, as long as the files are committed at the repository root and the site's production branch is connected. Serve it with HTTPS and appropriate caching. The app is not currently a native Android APK.

## How recording works

1. Add optional address and reference details beneath the camera. They stay visible beside/under the camera without navigating to another tab; saved locally in `localStorage`.
2. In **Settings**, choose planned recording length (auto bitrate) or manually set the video bitrate. Set resolution, frame rate, microphone, and camera.
3. Enable the camera. Tap **Record video**. `MediaRecorder` compresses/encodes the stream directly to MP4 or WebM as it arrives. Each timeslice (750ms requested) updates the live encoded-byte count.
4. The app **requests** a bitrate and stops early when measured bytes reach ~46 MB. Some browsers delay chunks or ignore bitrate settings. A final recording could still exceed 50 MB; if so, use the converter below.
5. Stop, review, share, or download the file. Under-limit recordings do not require any second conversion.

**Expected recording size is only an estimate.** There is no perfect live guarantee of a final hard 50 MB without a capable encoder/segment manager because browsers can buffer a large final chunk. The limit uses decimal 50,000,000 bytes (stricter than 50 MiB).

## Remember camera ON / OFF between visits

After you tap **Enable camera** or **Open camera** and the preview opens, the app saves `autoOpenCamera: true` with the other local preferences. When you return to the same Netlify URL on the same browser/device, it **tries to open the preview automatically** on page load. Recording does **not** start automatically. Selecting **Camera options → Off** saves `autoOpenCamera: false`, so future visits start with the camera off. The **Settings → Camera and audio → Open camera on next visit** switch allows you to change this preference without switching cameras on/off immediately.

This stores only a boolean preference (and the existing chosen camera ID), **not** camera access or permission itself. Camera permission is controlled by Android Chrome/iOS Safari and can be asked again after expiration, browser settings changes, private browsing or OS restrictions. On some iPhones, a user tap on **Show camera preview** may still be necessary. Each device/browser keeps its own local settings. Private/cleared browser storage will reset the preference. HTTPS is required.

## Overlay controls and fullscreen camera (Android + iPhone)

The live camera now carries all four primary actions **directly over the image**: Record, Pause/Resume, Stop, and Reset. All have labeled icons, large mobile hit targets, and disabled states that prevent accidental double-starts. **Reset** explicitly asks before discarding a recording. Starting a new take while an unsaved result exists also requests confirmation. The recorded video remains encoded while capturing; Stop finalizes the actual MP4/WebM blob. A **Review & save** overlay appears when finished and returns you to the file card.

The upper-right **Expand** button makes the camera fill the available screen. To keep control overlays accessible:

- **Android Chrome / compatible iPads**: use native _element_ fullscreen when available, including all HTML overlays; if fullscreen is rejected, fall back to fixed viewport mode.
- **iPhone Safari**: use a fixed `100dvh` _app-immersive_ layout. iPhone native _video_ fullscreen replaces the whole page with the native player and would hide Record/Pause/Stop/Reset; we intentionally **never** call `webkitEnterFullscreen()` for the camera. Safari's browser bars can remain visible — this is an iOS browser restriction, not a broken toggle. Add the web app to the iPhone Home Screen to run it in a standalone window without Safari tab controls. Not a native iOS IPA.
- **iOS video**: uses `playsinline`, `webkit-playsinline`, autoplay muted preview, an HTTPS permission request, and Safari's native MP4-capable `MediaRecorder` where available. The recorder retries with browser-selected encoding when an explicit MIME/codec is rejected. Share uses the iOS Share Sheet when supported; on iPhone that is generally the easiest way to **Save to Files**.
- **Known platform constraints**: mobile browsers can ignore requested bitrates, delay encoded chunks, deny camera access in split-screen, and suspend capture when backgrounded/locked. 46 MB is a conservative early-stop _target_, **not** a guaranteed hard cap. Keep the screen awake, review the actual size, and test on the specific iOS/Android devices used by technicians. Pause/resume is subject to browser `MediaRecorder` support.

### iPhone deployment

1. Deploy the built `dist/` to a trusted **HTTPS** URL and open it in Safari (not an insecure local-IP page).
2. Accept camera/microphone permission when prompted. Start a quick test take, then Stop and use **Share → Save to Files**.
3. Safari Share → **Add to Home Screen** provides standalone mode. The app includes a manifest, Apple touch icon, and iOS web-app metadata. It still requires internet to load unless a separate offline cache/service worker is added.
4. Test both portrait/landscape, pause/resume, and larger videos. If a specific older iOS version lacks recording support, the web app cannot bypass the system codec/API limitation; it would need a native fallback.

## File converter

Choose an existing file to convert locally. The app uses an invisible video decoder, canvas frame capture, a silent Web Audio capture path when available, and `MediaRecorder`. Conversion therefore takes approximately the input's playback duration; it is **not** a background transcoder and the screen should remain awake/foreground. It retries with reduced bitrate/resolution up to 3 times if output exceeds the limit. A browser might not decode some MOV/MKV codecs even if the file can be selected.

Under-50-MB input files (including iPhone MOV clips) are passed through without avoidable conversion; check destination format acceptance. The converter tries to retain audio, but browsers may disallow capturing audio from `<video>` in certain situations. If unavailable, it flags that the output may be silent. Inspect the result before uploading. A service that strictly requires H.264 MP4 may require server-side FFmpeg or a native Android encoding component when `MediaRecorder` cannot encode MP4.

## Mobile and split-screen considerations

The compact camera preview uses viewport-aware sizing, with address details immediately beneath it and controls in the same column. There are no mode tabs to lose the active camera. The page scrolls in very short split-screen windows; an Android device or browser can still suspend or terminate a camera stream if another app takes exclusive access. Web browsers cannot override that OS behavior.

## Source layout

- `src/App.vue`: one-screen capture workflow, file compression controls, status feedback.
- `src/components/AddressCard.vue`: persistent address reference and editable notes.
- `src/components/SettingsPanel.vue`: camera, length, bitrate, and conversion presets.
- `src/components/ResultCard.vue`: format/size checks, review, share and download.
- `src/composables/useRecorder.js`: live camera, video encoding, pause/resume, torch, zoom and early stop.
- `src/composables/useCompressor.js`: file transcoding, retries, cancellation, audio track and lifecycle cleanup.
- `src/composables/useLocalSettings.js`: local device preferences/address storage.
- `src/lib/media.js`: pure size/format/bitrate helpers; covered by `npm test`.

## Privacy and resource limits

Nothing is uploaded to a server. Videos remain in browser memory until saved, discarded, or the tab closes. Large videos can cause memory pressure on mobile; keep uploads reasonably sized and avoid re-encoding huge files in split-screen. Address data is never written into the video or sent remotely. The app is not designed for unattended/background recording.

## Add to Android Home Screen

Once deployed over HTTPS, open the site in Chrome and use **Add to Home screen / Install app** from the browser menu. A web app manifest is included for a standalone window. It still uses the browser's camera and encoder permissions and is **not an APK**.
