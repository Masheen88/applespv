// map.js

(() => {
  // -----------------------------
  // Tab switching (Video / Map)
  // -----------------------------
  const appTabVideo = document.getElementById("appTabVideo");
  const appTabMap = document.getElementById("appTabMap");
  const videoTabPanel = document.getElementById("videoTabPanel");
  const mapTabPanel = document.getElementById("mapTabPanel");

  function setAppTab(tab) {
    const isVideo = tab === "video";

    appTabVideo.classList.toggle("active", isVideo);
    appTabVideo.setAttribute("aria-selected", isVideo ? "true" : "false");

    appTabMap.classList.toggle("active", !isVideo);
    appTabMap.setAttribute("aria-selected", !isVideo ? "true" : "false");

    videoTabPanel.style.display = isVideo ? "" : "none";
    mapTabPanel.style.display = isVideo ? "none" : "";

    // Lazy init map when first opened
    if (!isVideo) initMapOnce();
  }

  if (appTabVideo && appTabMap) {
    appTabVideo.addEventListener("click", () => setAppTab("video"));
    appTabMap.addEventListener("click", () => setAppTab("map"));
  }

  // -----------------------------
  // Map + Tracking
  // -----------------------------
  let mapInited = false;
  let map = null;
  let tile = null;

  let watchId = null;
  let tracking = false;

  // Current position marker (blue dot)
  let youMarker = null;

  // Red “drop points”
  const droppedPoints = []; // [{lat,lng,marker,ts}]
  // Blue path polyline
  let pathLine = null;
  const pathLatLngs = [];

  // UI
  const mapBanner = document.getElementById("mapBanner");
  const mapReadout = document.getElementById("mapReadout");

  const startTrackBtn = document.getElementById("startTrackBtn");
  const dropPointBtn = document.getElementById("dropPointBtn");
  const exportMapBtn = document.getElementById("exportMapBtn");
  const clearMapBtn = document.getElementById("clearMapBtn");

  const mapExportArea = document.getElementById("mapExportArea");
  const mapExportImg = document.getElementById("mapExportImg");
  const mapDownloadLink = document.getElementById("mapDownloadLink");

  const zoomInBtn = document.getElementById("mapZoomInBtn");
  const zoomOutBtn = document.getElementById("mapZoomOutBtn");

  const panUpBtn = document.getElementById("mapPanUpBtn");
  const panDownBtn = document.getElementById("mapPanDownBtn");
  const panLeftBtn = document.getElementById("mapPanLeftBtn");
  const panRightBtn = document.getElementById("mapPanRightBtn");
  const centerBtn = document.getElementById("mapCenterBtn");

  // Icons (simple circles)
  const redDotIcon = L.divIcon({
    className: "redDotIcon",
    html: `<div style="
      width: 12px; height: 12px; border-radius: 999px;
      background: #ff2d2d; border: 2px solid rgba(0,0,0,.35);
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  const youIcon = L.divIcon({
    className: "youDotIcon",
    html: `<div style="
      width: 14px; height: 14px; border-radius: 999px;
      background: #2d7dff; border: 3px solid rgba(255,255,255,.95);
      box-shadow: 0 2px 12px rgba(0,0,0,.28);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  function initMapOnce() {
    if (mapInited) return;
    mapInited = true;

    // Create map (Leaflet is north-up by default; no rotation)
    map = L.map("map", {
      zoomControl: false, // we provide our own
      attributionControl: true,
      inertia: true,
      worldCopyJump: true,
    });

    // Satellite tiles (Esri World Imagery)
    // NOTE: Exporting to canvas requires CORS. We set crossOrigin.
    tile = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 20,
        attribution: "Tiles © Esri",
        crossOrigin: "anonymous",
      },
    ).addTo(map);

    // Start view (fallback)
    map.setView([36.1627, -86.7816], 18); // Nashville-ish default

    // Path polyline
    pathLine = L.polyline(pathLatLngs, {
      weight: 4,
      opacity: 0.9,
    }).addTo(map);

    // Wire UI buttons
    wireMapControls();

    // Try one-time location for initial center
    requestOneShotLocation();

    updateMapUI();
  }

  function wireMapControls() {
    if (zoomInBtn)
      zoomInBtn.addEventListener("click", () => map && map.zoomIn());
    if (zoomOutBtn)
      zoomOutBtn.addEventListener("click", () => map && map.zoomOut());

    const panBy = (dx, dy) => {
      if (!map) return;
      // Smooth-ish pan; small steps for mobile
      map.panBy([dx, dy], { animate: true, duration: 0.25 });
    };

    if (panUpBtn) panUpBtn.addEventListener("click", () => panBy(0, -140));
    if (panDownBtn) panDownBtn.addEventListener("click", () => panBy(0, 140));
    if (panLeftBtn) panLeftBtn.addEventListener("click", () => panBy(-140, 0));
    if (panRightBtn) panRightBtn.addEventListener("click", () => panBy(140, 0));

    if (centerBtn)
      centerBtn.addEventListener("click", () => {
        if (!map || !youMarker) return;
        map.setView(youMarker.getLatLng(), Math.max(map.getZoom(), 18), {
          animate: true,
        });
      });

    if (startTrackBtn)
      startTrackBtn.addEventListener("click", async () => {
        if (!tracking) {
          await startTracking();
        } else {
          stopTracking();
        }
      });

    if (dropPointBtn)
      dropPointBtn.addEventListener("click", () => {
        if (!youMarker) return;
        const ll = youMarker.getLatLng();
        dropPoint(ll.lat, ll.lng);
        updateMapUI();
      });

    if (clearMapBtn)
      clearMapBtn.addEventListener("click", () => {
        clearAll();
      });

    if (exportMapBtn)
      exportMapBtn.addEventListener("click", async () => {
        await exportMapImage();
      });
  }

  function requestOneShotLocation() {
    if (!navigator.geolocation) {
      showBanner(true, "Geolocation not supported on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        ensureYouMarker(latitude, longitude);

        // Center nicely once
        map.setView([latitude, longitude], 19, { animate: true });
        updateMapUI();
      },
      () => {
        showBanner(true);
        updateMapUI();
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0,
      },
    );
  }

  function showBanner(show, customText) {
    if (!mapBanner) return;
    mapBanner.style.display = show ? "" : "none";
    if (customText) {
      const p = mapBanner.querySelector("p");
      if (p) p.textContent = customText;
    }
  }

  function ensureYouMarker(lat, lng) {
    if (!map) return;

    if (!youMarker) {
      youMarker = L.marker([lat, lng], { icon: youIcon }).addTo(map);
    } else {
      youMarker.setLatLng([lat, lng]);
    }
  }

  function startTracking() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        showBanner(true, "Geolocation not supported on this device.");
        resolve(false);
        return;
      }

      // If already tracking, no-op
      if (tracking) {
        resolve(true);
        return;
      }

      tracking = true;
      updateMapUI();

      // Start watching
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          showBanner(false);

          const { latitude, longitude, accuracy } = pos.coords;

          ensureYouMarker(latitude, longitude);

          // Add to path
          const ll = L.latLng(latitude, longitude);
          pathLatLngs.push(ll);
          pathLine.setLatLngs(pathLatLngs);

          // Keep map reasonably centered while tracking (but don’t “lock” it hard)
          if (map && youMarker) {
            const bounds = map.getBounds();
            if (!bounds.contains(ll)) {
              map.panTo(ll, { animate: true, duration: 0.35 });
            }
          }

          updateMapReadout({ accuracy });
          updateMapUI();

          resolve(true);
        },
        (err) => {
          showBanner(true, err?.message || "Location permission required.");
          tracking = false;
          if (watchId != null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
          }
          updateMapUI();
          resolve(false);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 500,
          timeout: 15000,
        },
      );
    });
  }

  function stopTracking() {
    tracking = false;
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    updateMapUI();
    updateMapReadout();
  }

  function dropPoint(lat, lng) {
    if (!map) return;

    const marker = L.marker([lat, lng], { icon: redDotIcon }).addTo(map);
    droppedPoints.push({
      lat,
      lng,
      marker,
      ts: Date.now(),
    });
  }

  function clearAll() {
    // Remove dropped markers
    for (const p of droppedPoints) {
      try {
        p.marker.remove();
      } catch {}
    }
    droppedPoints.length = 0;

    // Clear path
    pathLatLngs.length = 0;
    if (pathLine) pathLine.setLatLngs(pathLatLngs);

    // Hide export preview
    if (mapExportArea) mapExportArea.style.display = "none";
    if (mapExportImg) mapExportImg.src = "";
    if (mapDownloadLink) mapDownloadLink.removeAttribute("href");

    updateMapUI();
    updateMapReadout();
  }

  function updateMapReadout(extra = {}) {
    if (!mapReadout) return;

    const gps = youMarker ? "OK" : "—";
    const pts = droppedPoints.length;
    const pathPts = pathLatLngs.length;

    let accText = "";
    if (typeof extra.accuracy === "number") {
      accText = ` • ±${Math.round(extra.accuracy)}m`;
    }

    mapReadout.textContent = `GPS: ${gps}${accText} • Points: ${pts} • Path: ${pathPts}`;
  }

  function updateMapUI() {
    const hasGPS = !!youMarker;
    const hasAny = droppedPoints.length > 0 || pathLatLngs.length > 0;

    if (startTrackBtn) {
      startTrackBtn.textContent = tracking ? "⏹️ Stop path" : "▶️ Start path";
    }

    if (dropPointBtn) dropPointBtn.disabled = !hasGPS;
    if (exportMapBtn) exportMapBtn.disabled = !map || (!hasAny && !hasGPS);
    if (clearMapBtn) clearMapBtn.disabled = !hasAny && !hasGPS;
  }

  async function exportMapImage() {
    if (!map) return;

    // Temporarily hide some UI overlays if you want a cleaner export
    // (You can comment these out if you want them included)
    const controls = document.querySelector(".mapControls");
    const actions = document.querySelector(".mapActionBar");
    const readout = document.querySelector(".mapReadout");

    const prevControls = controls ? controls.style.display : "";
    const prevActions = actions ? actions.style.display : "";
    const prevReadout = readout ? readout.style.display : "";

    try {
      if (controls) controls.style.display = "none";
      if (actions) actions.style.display = "none";
      if (readout) readout.style.display = "none";

      // Wait a tick so the DOM updates
      await new Promise((r) => setTimeout(r, 80));

      const el = map.getContainer();

      // NOTE: Some tile servers block canvas export. We set useCORS and crossOrigin above.
      const canvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: null,
        scale: Math.min(2, window.devicePixelRatio || 1),
      });

      const dataUrl = canvas.toDataURL("image/png");

      if (mapExportImg) mapExportImg.src = dataUrl;
      if (mapDownloadLink) mapDownloadLink.href = dataUrl;
      if (mapExportArea) mapExportArea.style.display = "";
    } catch (e) {
      alert(
        "Export failed. This usually happens if the satellite tile provider blocks canvas export.\n\nTry HTTPS, or switch tiles to a provider that supports CORS.",
      );
      console.error(e);
    } finally {
      if (controls) controls.style.display = prevControls;
      if (actions) actions.style.display = prevActions;
      if (readout) readout.style.display = prevReadout;
    }
  }

  // If someone lands on the map tab first (rare), still safe:
  // setAppTab("video") is implied by markup; map inits when opened.
})();
