// /map.js
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

    document.body.classList.toggle("comboMode", isCombo);

    if (videoTabPanel) videoTabPanel.style.display = isVideo ? "" : "none";
    if (mapTabPanel) mapTabPanel.style.display = isMap ? "" : "none";
    if (comboTabPanel) comboTabPanel.style.display = isCombo ? "" : "none";

    if (isMap || isCombo) initMapOnce();
    if (isCombo) initMiniMapOnce();

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

    updateMapUI();
  }

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
  if (comboExitBtn)
    comboExitBtn.addEventListener("click", () => setAppTab("video"));

  // -----------------------------
  // Map + Tracking
  // -----------------------------
  let mapInited = false;
  let map = null;

  // Combo minimap
  let miniInited = false;
  let miniMap = null;
  let miniYouMarker = null;
  const miniDropped = [];
  let miniPathLine = null;

  let watchId = null;
  let tracking = false;

  // Editing state
  let editMode = false;
  let editHandler = null;

  // Current position marker
  let youMarker = null;

  // Drop points (numbered)
  const droppedPoints = []; // [{id, n, lat, lng, marker, ts}]
  let nextDropId = 1;

  // Path polyline
  let pathLine = null;
  const pathLatLngs = [];

  // FeatureGroup that holds editable layers
  let editGroup = null;

  // Style controls (dot size + font size)
  const styleState = {
    dotSize: 28,
    fontSize: 14,
  };

  // UI
  const mapBanner = document.getElementById("mapBanner");
  const mapReadout = document.getElementById("mapReadout");
  const miniReadout = document.getElementById("miniReadout");

  const startTrackBtn = document.getElementById("startTrackBtn");
  const dropPointBtn = document.getElementById("dropPointBtn");
  const exportMapBtn = document.getElementById("exportMapBtn");
  const clearMapBtn = document.getElementById("clearMapBtn");

  const editMapBtn = document.getElementById("editMapBtn");
  const doneEditMapBtn = document.getElementById("doneEditMapBtn");
  const comboEditBtn = document.getElementById("comboEditBtn");

  const editStylePanel = document.getElementById("editStylePanel");
  const closeEditStyleBtn = document.getElementById("closeEditStyleBtn");
  const dpSizeRange = document.getElementById("dpSizeRange");
  const dpSizeLabel = document.getElementById("dpSizeLabel");
  const dpFontRange = document.getElementById("dpFontRange");
  const dpFontLabel = document.getElementById("dpFontLabel");

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

  // Combo controls
  const comboStartPathBtn = document.getElementById("comboStartPathBtn");
  const comboDropPointBtn = document.getElementById("comboDropPointBtn");
  const comboCenterBtn = document.getElementById("comboCenterBtn");

  // You marker icon
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

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 20,
        attribution: "Tiles © Esri",
        crossOrigin: "anonymous",
      },
    ).addTo(map);

    map.setView([36.1627, -86.7816], 18);

    editGroup = new L.FeatureGroup();
    editGroup.addTo(map);

    pathLine = L.polyline(pathLatLngs, { weight: 4, opacity: 0.9 });
    pathLine.addTo(map);
    editGroup.addLayer(pathLine);

    wireMapControls();
    wireStyleControls();

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

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 20,
        attribution: "",
        crossOrigin: "anonymous",
      },
    ).addTo(miniMap);

    miniMap.setView([36.1627, -86.7816], 18);

    miniPathLine = L.polyline([], { weight: 3, opacity: 0.9 }).addTo(miniMap);

    syncMiniFromState();
  }

  function syncMiniFromState() {
    if (!miniMap) return;

    if (youMarker) {
      const ll = youMarker.getLatLng();
      if (!miniYouMarker)
        miniYouMarker = L.marker(ll, { icon: youIcon }).addTo(miniMap);
      else miniYouMarker.setLatLng(ll);

      miniMap.setView(ll, Math.max(miniMap.getZoom(), 18), { animate: false });
    }

    if (miniPathLine) miniPathLine.setLatLngs(pathLatLngs);

    if (miniDropped.length) {
      for (const m of miniDropped) {
        try {
          m.remove();
        } catch {}
      }
      miniDropped.length = 0;
    }

    for (const p of droppedPoints) {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 5,
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.9,
      }).addTo(miniMap);
      miniDropped.push(m);
    }
  }

  function updateMiniReadout(text) {
    if (!miniReadout) return;
    miniReadout.textContent = text;
  }

  // -----------------------------
  // ✅ Numbered drop point icon
  // -----------------------------
  function buildDropPointIcon(n) {
    const size = styleState.dotSize;
    const font = styleState.fontSize;

    const safeText = String(n ?? "");
    const html = `
      <div class="dot" style="
        width:${size}px;
        height:${size}px;
        font-size:${font}px;
      ">${escapeHtml(safeText)}</div>
    `;

    return L.divIcon({
      className: "dropPointIcon",
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function updateAllDropPointIcons() {
    for (const p of droppedPoints) {
      try {
        p.marker.setIcon(buildDropPointIcon(p.n));
      } catch {}
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // -----------------------------
  // Controls wiring
  // -----------------------------
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
        if (!tracking) await startTracking();
        else stopTracking();
      });

    if (comboStartPathBtn)
      comboStartPathBtn.addEventListener("click", async () => {
        if (!tracking) await startTracking();
        else stopTracking();
      });

    if (dropPointBtn)
      dropPointBtn.addEventListener("click", () => {
        if (!youMarker) return;
        const ll = youMarker.getLatLng();
        dropPoint(ll.lat, ll.lng);
        updateMapUI();
      });

    if (comboDropPointBtn)
      comboDropPointBtn.addEventListener("click", () => {
        if (!youMarker) return;
        const ll = youMarker.getLatLng();
        dropPoint(ll.lat, ll.lng);
        updateMapUI();
      });

    if (comboCenterBtn)
      comboCenterBtn.addEventListener("click", () => {
        if (!map || !youMarker) return;
        map.setView(youMarker.getLatLng(), Math.max(map.getZoom(), 18), {
          animate: true,
        });
      });

    if (clearMapBtn) clearMapBtn.addEventListener("click", () => clearAll());
    if (exportMapBtn)
      exportMapBtn.addEventListener("click", async () => exportMapImage());

    if (editMapBtn) editMapBtn.addEventListener("click", () => enterEditMode());
    if (doneEditMapBtn)
      doneEditMapBtn.addEventListener("click", () => exitEditMode());

    if (comboEditBtn)
      comboEditBtn.addEventListener("click", () => {
        if (editMode) exitEditMode();
        else enterEditMode();
      });

    // ✅ Close button inside Edit Style panel
    if (closeEditStyleBtn)
      closeEditStyleBtn.addEventListener("click", () => exitEditMode());
  }

  function wireStyleControls() {
    if (dpSizeRange) styleState.dotSize = Number(dpSizeRange.value || 28);
    if (dpFontRange) styleState.fontSize = Number(dpFontRange.value || 14);

    if (dpSizeLabel) dpSizeLabel.textContent = String(styleState.dotSize);
    if (dpFontLabel) dpFontLabel.textContent = String(styleState.fontSize);

    if (dpSizeRange) {
      dpSizeRange.addEventListener("input", () => {
        styleState.dotSize = Number(dpSizeRange.value || 28);
        if (dpSizeLabel) dpSizeLabel.textContent = String(styleState.dotSize);
        updateAllDropPointIcons();
      });
    }

    if (dpFontRange) {
      dpFontRange.addEventListener("input", () => {
        styleState.fontSize = Number(dpFontRange.value || 14);
        if (dpFontLabel) dpFontLabel.textContent = String(styleState.fontSize);
        updateAllDropPointIcons();
      });
    }
  }

  // -----------------------------
  // Location
  // -----------------------------
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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
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

    if (!youMarker)
      youMarker = L.marker([lat, lng], { icon: youIcon }).addTo(map);
    else youMarker.setLatLng([lat, lng]);

    if (miniMap) {
      const ll = L.latLng(lat, lng);
      if (!miniYouMarker)
        miniYouMarker = L.marker(ll, { icon: youIcon }).addTo(miniMap);
      else miniYouMarker.setLatLng(ll);

      miniMap.setView(ll, Math.max(miniMap.getZoom(), 18), { animate: false });
    }
  }

  // -----------------------------
  // Tracking
  // -----------------------------
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

      if (editMode) exitEditMode(true);

      tracking = true;
      updateMapUI();

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          showBanner(false);

          const { latitude, longitude, accuracy } = pos.coords;
          ensureYouMarker(latitude, longitude);

          const ll = L.latLng(latitude, longitude);
          pathLatLngs.push(ll);

          if (pathLine) pathLine.setLatLngs(pathLatLngs);
          if (miniPathLine) miniPathLine.setLatLngs(pathLatLngs);

          if (map && youMarker) {
            const bounds = map.getBounds();
            if (!bounds.contains(ll))
              map.panTo(ll, { animate: true, duration: 0.35 });
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
        { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 },
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

  // -----------------------------
  // Drop points (numbered)
  // -----------------------------
  function dropPoint(lat, lng) {
    if (!map) return;

    const n = droppedPoints.length + 1;
    const icon = buildDropPointIcon(n);

    const marker = L.marker([lat, lng], {
      icon,
      draggable: false,
      keyboard: false,
    }).addTo(map);

    if (editGroup) editGroup.addLayer(marker);

    const id = nextDropId++;
    const item = { id, n, lat, lng, marker, ts: Date.now() };
    droppedPoints.push(item);

    marker.on("click", () => {
      if (!editMode) return;
      promptRenumber(item);
    });

    syncMiniFromState();
  }

  function promptRenumber(item) {
    const current = item.n ?? "";
    const v = prompt("Point number:", String(current));
    if (v == null) return;

    const trimmed = String(v).trim();
    if (!trimmed) return;

    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0) {
      alert("Please enter a positive number.");
      return;
    }

    item.n = Math.floor(num);
    try {
      item.marker.setIcon(buildDropPointIcon(item.n));
    } catch {}

    updateMapReadout();
  }

  // -----------------------------
  // Edit Mode (Leaflet.draw)
  // -----------------------------
  function enterEditMode() {
    if (!map || !editGroup) return;
    if (tracking) return;

    const hasAny = droppedPoints.length > 0 || pathLatLngs.length > 1;
    if (!hasAny) return;

    if (editMode) return;
    editMode = true;

    try {
      if (!L.EditToolbar || !L.EditToolbar.Edit)
        throw new Error("Leaflet.draw edit not available.");

      editHandler = new L.EditToolbar.Edit(map, {
        featureGroup: editGroup,
        selectedPathOptions: { maintainColor: true },
      });

      editHandler.enable();
    } catch (e) {
      console.warn(e);
      alert("Edit mode failed to start. Leaflet.draw may not have loaded.");
      editMode = false;
      editHandler = null;
      return;
    }

    updateMapUI();
  }

  function exitEditMode(silent = false) {
    if (!map || !editGroup) return;
    if (!editMode) return;

    editMode = false;

    try {
      if (editHandler) editHandler.disable();
    } catch {}
    editHandler = null;

    commitEditsToState();

    if (!silent) {
      // no toast system
    }

    updateMapUI();
    syncMiniFromState();
  }

  function commitEditsToState() {
    for (const p of droppedPoints) {
      try {
        const ll = p.marker.getLatLng();
        p.lat = ll.lat;
        p.lng = ll.lng;
      } catch {}
    }

    if (pathLine) {
      try {
        const ll = pathLine.getLatLngs() || [];
        pathLatLngs.length = 0;
        for (const x of ll) pathLatLngs.push(L.latLng(x.lat, x.lng));
        if (miniPathLine) miniPathLine.setLatLngs(pathLatLngs);
      } catch {}
    }

    updateMapReadout();
  }

  // -----------------------------
  // Clear / Readout / UI
  // -----------------------------
  function clearAll() {
    if (editMode) {
      try {
        if (editHandler) editHandler.disable();
      } catch {}
      editHandler = null;
      editMode = false;
    }

    for (const p of droppedPoints) {
      try {
        p.marker.remove();
      } catch {}
    }
    droppedPoints.length = 0;

    pathLatLngs.length = 0;
    if (pathLine) pathLine.setLatLngs(pathLatLngs);
    if (miniPathLine) miniPathLine.setLatLngs(pathLatLngs);

    if (editGroup) {
      try {
        editGroup.clearLayers();
        if (pathLine) editGroup.addLayer(pathLine);
      } catch {}
    }

    if (mapExportArea) mapExportArea.style.display = "none";
    if (mapExportImg) mapExportImg.src = "";
    if (mapDownloadLink) mapDownloadLink.removeAttribute("href");

    syncMiniFromState();
    updateMapUI();
    updateMapReadout();
  }

  function updateMapReadout(extra = {}) {
    if (!mapReadout) return;

    const gps = youMarker ? "OK" : "—";
    const pts = droppedPoints.length;
    const pathPts = pathLatLngs.length;

    let accText = "";
    if (typeof extra.accuracy === "number")
      accText = ` • ±${Math.round(extra.accuracy)}m`;

    const editText = editMode ? " • EDITING" : "";
    const text = `GPS: ${gps}${accText} • Points: ${pts} • Path: ${pathPts}${editText}`;
    mapReadout.textContent = text;

    updateMiniReadout(
      `GPS: ${gps}${accText} • Points: ${pts} • Path: ${pathPts}`,
    );
  }

  function updateMapUI() {
    const hasGPS = !!youMarker;
    const hasAny = droppedPoints.length > 0 || pathLatLngs.length > 1;

    // ✅ lets CSS keep buttons above the panel
    document.body.classList.toggle("mapEditMode", editMode);

    if (startTrackBtn) {
      startTrackBtn.textContent = tracking ? "⏹️ Stop path" : "▶️ Start path";
      startTrackBtn.disabled = editMode;
    }

    if (comboStartPathBtn) {
      comboStartPathBtn.textContent = tracking
        ? "⏹️ Stop path"
        : "▶️ Start path";
      comboStartPathBtn.disabled = editMode;
    }

    if (dropPointBtn) dropPointBtn.disabled = !hasGPS || editMode;
    if (comboDropPointBtn) comboDropPointBtn.disabled = !hasGPS || editMode;

    if (comboCenterBtn) comboCenterBtn.disabled = !hasGPS;

    if (exportMapBtn)
      exportMapBtn.disabled = !map || (!hasAny && !hasGPS) || editMode;
    if (clearMapBtn) clearMapBtn.disabled = (!hasAny && !hasGPS) || editMode;

    const canEdit = !!map && !tracking && hasAny;

    if (editMapBtn) {
      editMapBtn.disabled = !canEdit || editMode;
      editMapBtn.style.display = editMode ? "none" : "";
    }

    if (doneEditMapBtn) doneEditMapBtn.style.display = editMode ? "" : "none";

    if (comboEditBtn) {
      comboEditBtn.disabled = !canEdit;
      comboEditBtn.textContent = editMode ? "✅ Done" : "✏️ Edit";
    }

    if (editStylePanel) editStylePanel.style.display = editMode ? "" : "none";

    updateMapReadout();
    syncMiniFromState();
  }

  async function exportMapImage() {
    if (!map) return;

    const controls = document.querySelector(".mapControls");
    const actions = document.querySelector(".mapActionBar");
    const readout = document.querySelector(".mapReadout");
    const stylePanel = document.querySelector(".editStylePanel");

    const prevControls = controls ? controls.style.display : "";
    const prevActions = actions ? actions.style.display : "";
    const prevReadout = readout ? readout.style.display : "";
    const prevPanel = stylePanel ? stylePanel.style.display : "";

    try {
      if (controls) controls.style.display = "none";
      if (actions) actions.style.display = "none";
      if (readout) readout.style.display = "none";
      if (stylePanel) stylePanel.style.display = "none";

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
      if (stylePanel) stylePanel.style.display = prevPanel;
    }
  }

  // Default tab
  setAppTab("video");
})();