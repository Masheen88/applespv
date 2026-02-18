// map.js
(() => {
  // -----------------------------
  // Tab switching (Video / Map / Combo)
  // -----------------------------
  const appTabVideo = document.getElementById("appTabVideo");
  const appTabMap = document.getElementById("appTabMap");
  const appTabCombo = document.getElementById("appTabCombo");
  const videoTabPanel = document.getElementById("videoTabPanel");
  const mapTabPanel = document.getElementById("mapTabPanel");
  const comboTabPanel = document.getElementById("comboTabPanel");
  const comboExitBtn = document.getElementById("comboExitBtn");

  function setAppTab(tab) {
    const isVideo = tab === "video";
    const isMap = tab === "map";
    const isCombo = tab === "combo";

    // ✅ IMPORTANT: only hide header in combo mode
    document.body.classList.toggle("comboMode", isCombo);

    if (appTabVideo)
      appTabVideo.addEventListener("click", () => {
        document.body.classList.remove("comboMode");
        setAppTab("video");
      });

    if (appTabMap)
      appTabMap.addEventListener("click", () => {
        document.body.classList.remove("comboMode");
        setAppTab("map");
      });

    if (appTabCombo)
      appTabCombo.addEventListener("click", () => setAppTab("combo"));

    if (comboExitBtn) {
      comboExitBtn.addEventListener("click", () => setAppTab("video"));
    }

    if (videoTabPanel) videoTabPanel.style.display = isVideo ? "" : "none";
    if (mapTabPanel) mapTabPanel.style.display = isMap ? "" : "none";
    if (comboTabPanel) comboTabPanel.style.display = isCombo ? "" : "none";

    // Lazy init map when Map or Combo opens (tracking relies on it)
    if (isMap || isCombo) initMapOnce();

    // Minimap lives inside Combo tab
    if (isCombo) initMiniMapOnce();

    // Leaflet needs a size invalidate when a map becomes visible
    if (isMap && map) {
      setTimeout(() => {
        try {
          map.invalidateSize();
        } catch (_) {}
      }, 80);
    }
    if (isCombo && miniMap) {
      setTimeout(() => {
        try {
          miniMap.invalidateSize();
        } catch (_) {}
      }, 80);
    }
  }

  if (appTabVideo)
    appTabVideo.addEventListener("click", () => setAppTab("video"));
  if (appTabMap) appTabMap.addEventListener("click", () => setAppTab("map"));
  if (appTabCombo)
    appTabCombo.addEventListener("click", () => setAppTab("combo"));

  // -----------------------------
  // Map + Tracking
  // -----------------------------
  let mapInited = false;
  let map = null;
  let tile = null;

  // Combo minimap (GTA-style overlay)
  let miniInited = false;
  let miniMap = null;
  let miniTile = null;

  let miniYouMarker = null;
  const miniDropped = []; // markers
  let miniPathLine = null;

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
  const miniReadout = document.getElementById("miniReadout");

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

    map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
      inertia: true,
      worldCopyJump: true,
    });

    tile = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 20,
        attribution: "Tiles © Esri",
        crossOrigin: "anonymous",
      },
    ).addTo(map);

    map.setView([36.1627, -86.7816], 18);

    pathLine = L.polyline(pathLatLngs, {
      weight: 4,
      opacity: 0.9,
    }).addTo(map);

    wireMapControls();
    requestOneShotLocation();

    updateMapUI();
    syncMiniFromState();
  }

  function initMiniMapOnce() {
    if (miniInited) return;
    const el = document.getElementById("minimap");
    if (!el) return;

    miniInited = true;

    miniMap = L.map("minimap", {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
      inertia: false,
    });

    miniTile = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 20,
        attribution: "",
        crossOrigin: "anonymous",
      },
    ).addTo(miniMap);

    miniMap.setView([36.1627, -86.7816], 18);

    miniPathLine = L.polyline([], {
      weight: 3,
      opacity: 0.9,
    }).addTo(miniMap);

    syncMiniFromState();
  }

  function syncMiniFromState() {
    if (!miniMap) return;

    if (youMarker) {
      const ll = youMarker.getLatLng();
      if (!miniYouMarker) {
        miniYouMarker = L.marker(ll, { icon: youIcon }).addTo(miniMap);
      } else {
        miniYouMarker.setLatLng(ll);
      }
      miniMap.setView(ll, Math.max(miniMap.getZoom(), 18), { animate: false });
    }

    if (miniPathLine) {
      miniPathLine.setLatLngs(pathLatLngs);
    }

    if (miniDropped.length === 0 && droppedPoints.length > 0) {
      for (const p of droppedPoints) {
        const m = L.marker([p.lat, p.lng], { icon: redDotIcon }).addTo(miniMap);
        miniDropped.push(m);
      }
    }
  }

  function updateMiniReadout(text) {
    if (!miniReadout) return;
    miniReadout.textContent = text;
  }

  function wireMapControls() {
    if (zoomInBtn)
      zoomInBtn.addEventListener("click", () => map && map.zoomIn());
    if (zoomOutBtn)
      zoomOutBtn.addEventListener("click", () => map && map.zoomOut());

    const panBy = (dx, dy) => {
      if (!map) return;
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

    if (clearMapBtn) clearMapBtn.addEventListener("click", () => clearAll());
    if (exportMapBtn)
      exportMapBtn.addEventListener("click", async () => exportMapImage());
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

    if (miniMap) {
      const ll = L.latLng(lat, lng);
      if (!miniYouMarker) {
        miniYouMarker = L.marker(ll, { icon: youIcon }).addTo(miniMap);
      } else {
        miniYouMarker.setLatLng(ll);
      }
      miniMap.setView(ll, Math.max(miniMap.getZoom(), 18), { animate: false });
    }
  }

  function startTracking() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        showBanner(true, "Geolocation not supported on this device.");
        resolve(false);
        return;
      }

      if (tracking) {
        resolve(true);
        return;
      }

      tracking = true;
      updateMapUI();

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          showBanner(false);

          const { latitude, longitude, accuracy } = pos.coords;

          ensureYouMarker(latitude, longitude);

          const ll = L.latLng(latitude, longitude);
          pathLatLngs.push(ll);
          pathLine.setLatLngs(pathLatLngs);
          if (miniPathLine) miniPathLine.setLatLngs(pathLatLngs);

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
    if (miniMap) {
      const mm = L.marker([lat, lng], { icon: redDotIcon }).addTo(miniMap);
      miniDropped.push(mm);
    }
    droppedPoints.push({ lat, lng, marker, ts: Date.now() });
  }

  function clearAll() {
    for (const p of droppedPoints) {
      try {
        p.marker.remove();
      } catch {}
    }
    droppedPoints.length = 0;

    for (const m of miniDropped) {
      try {
        m.remove();
      } catch {}
    }
    miniDropped.length = 0;

    pathLatLngs.length = 0;
    if (pathLine) pathLine.setLatLngs(pathLatLngs);
    if (miniPathLine) miniPathLine.setLatLngs(pathLatLngs);

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

    const text = `GPS: ${gps}${accText} • Points: ${pts} • Path: ${pathPts}`;
    mapReadout.textContent = text;
    updateMiniReadout(text);
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

      await new Promise((r) => setTimeout(r, 80));

      const el = map.getContainer();

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
  setAppTab("video");
  // default tab is Video by markup; map initializes lazily.
})();
