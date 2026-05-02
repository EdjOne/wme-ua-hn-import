// ==UserScript==
// @name         WME Quick HN Importer - Ukraine
// @namespace    https://github.com/waze-ua/wme-ua-hn-import
// @version      1.0.0
// @description  Швидке додавання номерів будинків (Україна) через клікабельні точки на карті
// @author       Edj (адаптація на основі ThatByte / zigapovhe)
// @downloadURL  https://raw.githubusercontent.com/waze-ua/wme-ua-hn-import/main/ua-hn-import.user.js
// @updateURL    https://raw.githubusercontent.com/waze-ua/wme-ua-hn-import/main/ua-hn-import.user.js
// @supportURL   https://github.com/waze-ua/wme-ua-hn-import/issues
// @icon         https://raw.githubusercontent.com/waze-ua/wme-ua-hn-import/main/icon48.png
// @icon64       https://raw.githubusercontent.com/waze-ua/wme-ua-hn-import/main/icon64.png
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/*
// @exclude      https://www.waze.com/user/editor*
// @connect      stat.waze.com.ua
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @license      MIT
// @noframes
// ==/UserScript==

/*
 * Click handling and nearest segment matching based on work by
 * Tom 'Glodenox' Puttemans (https://github.com/Glodenox/wme-quick-hn-importer)
 *
 * Ukrainian adaptation based on:
 * - https://github.com/zigapovhe/wme-sl-hn-import (Slovenia version)
 * - https://github.com/waze-ua/WME-UA-address-data (UA address polygons)
 *
 * Data source: stat.waze.com.ua (Waze Україна address server)
 * Projection: WGS84 (EPSG:4326) — no reprojection needed
 */

/* global I18n, getWmeSdk, unsafeWindow */

(function () {
  'use strict';

  let wmeSDK;
  const SDK_LAYER_NAME = 'qhnua-sdk';
  const SDK_NAVPOINTS_LAYER_NAME = 'qhnua-navpoints';

  const MAX_CLICK_DISTANCE_PX = 25;
  const MAX_HN_CONFLICT_DISTANCE = 10;

  // UA address server API
  const UA_API = 'https://stat.waze.com.ua/address_map/address_map.php';
  const UA_TIMEOUT = 15000;
  const UA_BUFFER_DEFAULT = 400; // default radius in meters for zoom 18+

  // Common Ukrainian street name abbreviations
  const ABBREVIATIONS = {
    'вул.': 'вулиця',
    'пров.': 'провулок',
    'просп.': 'проспект',
    'бульв.': 'бульвар',
    'пл.': 'площа',
    'м-н': 'майдан',
    'узв.': 'узвіз',
    'наб.': 'набережна',
    'шосе': 'шосе',
    'туп.': 'тупик',
    'пр.': 'проїзд',
    'спуск': 'узвіз',
    'просп.': 'проспект'
  };

  const LS = {
    getBuffer()       { return Number(localStorage.getItem('qhnua-buffer') ?? '500'); },
    setBuffer(v)      { localStorage.setItem('qhnua-buffer', String(v)); },
    getLayerVisible() { return localStorage.getItem('qhnua-layer-visible') === '1'; },
    setLayerVisible(v){ localStorage.setItem('qhnua-layer-visible', v ? '1' : '0'); },
    getSelectedOnly() { return localStorage.getItem('qhnua-selected-only') === '1'; },
    setSelectedOnly(v){ localStorage.setItem('qhnua-selected-only', v ? '1' : '0'); },
    getNavPoints()    { return localStorage.getItem('qhnua-navpoints') === '1'; },
    setNavPoints(v)   { localStorage.setItem('qhnua-navpoints', v ? '1' : '0'); }
  };

  const toast = (msg, type = 'info') => {
    try {
      if (wmeSDK?.Notifications?.show) {
        wmeSDK.Notifications.show({ text: msg, type, timeout: 3500 });
      } else {
        console.info(`[UA-HN] ${msg}`);
      }
    } catch (_) {
      console.info(`[UA-HN] ${msg}`);
    }
  };

  function normalizeStreetName(name) {
    return String(name).toLowerCase().replace(/\s+/g, '_');
  }

  // Escape HTML special characters for safe attribute insertion
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Expand abbreviations and normalize for comparison
  function normalizeForComparison(name) {
    let normalized = String(name).toLowerCase().trim();

    for (const [abbrev, full] of Object.entries(ABBREVIATIONS)) {
      const escapedAbbrev = abbrev.replace(/\./g, '\\.');
      const regex = new RegExp('(^|\\s)' + escapedAbbrev + '(?=\\s|$)', 'gi');
      normalized = normalized.replace(regex, '$1' + full);
    }

    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, ' ');

    return normalized;
  }

  function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Calculate similarity between two strings (0-1)
  function calculateSimilarity(str1, str2) {
    const s1 = normalizeForComparison(str1);
    const s2 = normalizeForComparison(str2);

    // Exact match after normalization
    if (s1 === s2) return 1.0;

    // Match without diacritics
    if (removeDiacritics(s1) === removeDiacritics(s2)) return 0.95;

    // Levenshtein distance based similarity
    const distance = levenshteinDistance(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);
    const similarity = 1 - (distance / maxLen);

    return similarity;
  }

  // Levenshtein distance implementation
  function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[m][n];
  }

  function getHNGeometry(hn) {
    if (!hn?.geometry?.coordinates) return null;
    return { x: hn.geometry.coordinates[0], y: hn.geometry.coordinates[1] };
  }

  function getSelectedSegments() {
    const sel = wmeSDK.Editing.getSelection();
    if (!sel || sel.objectType !== 'segment') return [];
    return sel.ids
      .map(id => wmeSDK.DataModel.Segments.getById({ segmentId: id }))
      .filter(Boolean);
  }

  // Check if a house number has a nearby conflict (different HN within threshold distance)
  function hasConflict(hn, wx, wy, entry) {
    if (!entry?.items?.length) return false;
    for (const it of entry.items) {
      if (!it || it.x == null || it.y == null) continue;
      if (it.num !== hn) {
        const dx = wx - it.x, dy = wy - it.y;
        if (dx * dx + dy * dy <= MAX_HN_CONFLICT_DISTANCE * MAX_HN_CONFLICT_DISTANCE) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Parse the UA address name field into components.
   * Format: "м.Київ\n р-н Шевченківський\n вул. Хрещатик\n 22"
   */
  function parseUaAddress(name, centerStr) {
    const lines = String(name).split('\n').map(l => l.trim()).filter(Boolean);
    // lines[0] = city, lines[1] = district, lines[2] = street, lines[3] = house_number
    // Some entries may have only 3 lines (no house number)
    const city = lines[0] || '';
    const district = lines[1] || '';
    const street = lines[2] || '';
    const houseNumber = lines[3] || '';

    // Parse center: "50.449824026649;30.522160217595" (lat;lon)
    let lat, lon;
    if (centerStr) {
      const parts = centerStr.split(';').map(Number);
      lat = parts[0];
      lon = parts[1];
    }

    return { city, district, street, houseNumber, lat, lon };
  }

  // Fetch addresses from UA API
  function fetchAddresses(centerLat, centerLon, radius) {
    return new Promise((resolve, reject) => {
      const url = UA_API + `?lat=${centerLat}&lon=${centerLon}&radius=${Math.round(radius)}`;

      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: UA_TIMEOUT,
        onload: function (response) {
          try {
            const data = JSON.parse(response.responseText);

            if (data.result !== 'success' || !data.data?.polygons?.Default) {
              reject(new Error('Invalid API response'));
              return;
            }

            const polygons = data.data.polygons.Default;

            // Filter to only "active" addresses with house numbers
            const features = [];
            const streetNames = {};
            const streets = {};

            for (const item of polygons) {
              if (item.status !== 'active') continue;

              const parsed = parseUaAddress(item.name, item.center);
              if (!parsed.houseNumber || !parsed.street) continue;
              if (parsed.lat == null || parsed.lon == null) continue;

              const streetId = normalizeStreetName(parsed.street);
              if (!streets[parsed.street]) {
                streets[parsed.street] = streetId;
                streetNames[streetId] = parsed.street;
              }

              features.push({
                number: parsed.houseNumber.toLowerCase(),
                street: streetId,
                streetRaw: parsed.street,
                houseNumberRaw: parsed.houseNumber,
                lat: parsed.lat,
                lon: parsed.lon,
                city: parsed.city,
                district: parsed.district
              });
            }

            resolve({ features, streets, streetNames });
          } catch (err) {
            reject(err);
          }
        },
        onerror: function (err) {
          reject(err);
        },
        ontimeout: function () {
          reject(new Error('UA address server request timed out'));
        }
      });
    });
  }

  // Copy text to clipboard
  function copyToClipboard(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      toast(`Скопійовано: "${text}"`, 'success');
    } else {
      navigator.clipboard.writeText(text).then(() => {
        toast(`Скопійовано: "${text}"`, 'success');
      }).catch(() => {
        toast('Не вдалося скопіювати', 'error');
      });
    }
  }

  // Update selected segment's street name via WME SDK
  function updateSegmentStreetName(newStreetName, onSuccess) {
    const selectedSegments = getSelectedSegments();
    if (selectedSegments.length === 0) {
      toast('Не вибрано сегмент', 'warning');
      return;
    }

    const segment = selectedSegments[0];
    const segmentId = segment.id;

    const currentStreetId = segment.primaryStreetId;
    const currentStreet = currentStreetId ? wmeSDK.DataModel.Streets.getById({ streetId: currentStreetId }) : null;
    const cityId = currentStreet?.cityId;

    if (!cityId) {
      toast('Сегмент не має призначеного міста', 'warning');
      return;
    }

    try {
      let street = wmeSDK.DataModel.Streets.getStreet({
        cityId: cityId,
        streetName: newStreetName
      });

      if (!street) {
        console.debug('[UA-HN] Вулицю не знайдено, створюємо нову:', newStreetName);
        street = wmeSDK.DataModel.Streets.addStreet({
          streetName: newStreetName,
          cityId: cityId
        });
      }

      console.debug('[UA-HN] Знайдено вулицю:', street);

      wmeSDK.DataModel.Segments.updateAddress({
        segmentId: segmentId,
        primaryStreetId: street.id
      });

      console.debug('[UA-HN] Оновлено сегмент', segmentId, 'на вулицю ID:', street.id);
      toast(`Оновлено назву вулиці на "${newStreetName}"`, 'success');

      if (typeof onSuccess === 'function') {
        onSuccess();
      }
    } catch (err) {
      console.error('[UA-HN] Помилка оновлення назви вулиці:', err);
      toast('Помилка оновлення назви вулиці', 'error');
    }
  }

  function init() {
    let currentStreetId = null;
    let streetNames = {};
    let streets = {};
    let lastFeatures = [];
    let lastSdkFeatureIds = [];
    let isLoading = false;
    let currentLoadId = 0;
    let userWantsLayerVisible = false;
    let streetNameSpan = null;
    let currentStreetDiv = null;
    let streetAnalysisDiv = null;

    let chkMissing = null;
    let chkSelectedOnly = null;

    let applyFeatureFilter = () => {};
    let analyzeStreetMatches = () => {};

    try {
      I18n.translations[I18n.currentLocale()].layers.name['quick-hn-ua-importer'] = 'Quick HN Importer (UA)';
    } catch (_) {}

    wmeSDK.Map.addLayer({
      layerName: SDK_LAYER_NAME,
      zIndexing: true,
      styleContext: {
        getFillColor: ({ feature }) => {
          const p = feature.properties;
          if (p.conflict) return '#ff6666';
          return p.isSelectedStreet ? '#99ee99' : '#fb9c4f';
        },
        getOpacity: ({ feature }) => {
          const p = feature.properties;
          if (p.conflict) return 1;
          return (p.isSelectedStreet && p.processed) ? 0.3 : 1;
        },
        getRadius: ({ feature }) => {
          const num = feature.properties.number;
          return num ? Math.max(String(num).length * 7, 12) : 12;
        },
        getLabel: ({ feature }) => String(feature.properties.number ?? '')
      },
      styleRules: [{
        style: {
          graphicName: 'circle',
          pointRadius: '${getRadius}',
          fillColor: '${getFillColor}',
          fillOpacity: '${getOpacity}',
          strokeColor: '#ffffff',
          strokeWidth: 2,
          strokeOpacity: '${getOpacity}',
          label: '${getLabel}',
          fontColor: '#111111',
          fontWeight: 'bold',
          labelOutlineColor: '#ffffff',
          labelOutlineWidth: 0
        }
      }]
    });
    wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: false });

    let lastComputedVisibility = false;
    function updateLayerVisibility() {
      const currentZoom = wmeSDK.Map.getZoomLevel();
      const shouldBeVisible = userWantsLayerVisible && currentZoom >= 18;

      if (shouldBeVisible === lastComputedVisibility) return;
      lastComputedVisibility = shouldBeVisible;

      wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: shouldBeVisible });

      if (userWantsLayerVisible && !shouldBeVisible && lastFeatures.length > 0) {
        toast('Наблизьте до рівня 18+, щоб побачити номери будинків', 'info');
      }
    }

    wmeSDK.Events.on({ eventName: 'wme-map-zoom-changed', eventHandler: updateLayerVisibility });
    wmeSDK.Events.on({ eventName: 'wme-map-move-end', eventHandler: updateLayerVisibility });
    wmeSDK.Events.on({ eventName: 'wme-selection-changed', eventHandler: onSelectionChanged });

    // Get current WME street name from selection
    function getWmeStreetName() {
      const selectedSegments = getSelectedSegments();
      if (selectedSegments.length === 0) return null;

      const seg = selectedSegments[0];
      const primaryStreetId = seg.primaryStreetId;
      if (!primaryStreetId) return null;

      const street = wmeSDK.DataModel.Streets.getById({ streetId: primaryStreetId });
      return street?.name || null;
    }

    // Analyze street name matches and update UI
    analyzeStreetMatches = function() {
      if (!streetAnalysisDiv) return;
      if (!lastFeatures.length) {
        streetAnalysisDiv.style.display = 'none';
        return;
      }

      const wmeStreetName = getWmeStreetName();

      // Count addresses per official street name
      const streetCounts = {};
      lastFeatures.forEach(f => {
        const name = streetNames[f.street];
        if (!name) return;
        streetCounts[name] = (streetCounts[name] || 0) + 1;
      });

      // Sort by count descending
      const sorted = Object.entries(streetCounts)
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));

      if (sorted.length === 0) {
        streetAnalysisDiv.style.display = 'none';
        return;
      }

      // Check how many match current WME street
      const matchCount = wmeStreetName ? (streetCounts[wmeStreetName] || 0) : 0;
      const hasMismatch = wmeStreetName && matchCount === 0 && sorted.length > 0;

      // Find fuzzy match if there's a mismatch
      let suggestedMatch = null;
      let suggestionSimilarity = 0;

      if (hasMismatch && wmeStreetName) {
        for (const [name] of sorted) {
          const similarity = calculateSimilarity(wmeStreetName, name);
          if (similarity > 0.7 && similarity > suggestionSimilarity) {
            suggestedMatch = name;
            suggestionSimilarity = similarity;
          }
        }
      }

      // Build HTML
      let html = '';

      if (hasMismatch) {
        html += `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:8px;margin-bottom:8px;">`;
        html += `<b style="color:#856404;">⚠️ Не знайдено співпадінь!</b><br/>`;
        html += `<span style="font-size:11px;color:#856404;">Назва вулиці в WME не збігається з жодною офіційною назвою</span>`;
        html += `</div>`;

        if (suggestedMatch) {
          const escapedSuggested = escapeHtml(suggestedMatch);
          html += `<div style="background:#d4edda;border:1px solid #28a745;border-radius:4px;padding:8px;margin-bottom:8px;">`;
          html += `<b style="color:#155724;">💡 Можливе співпадіння:</b><br/>`;
          html += `<div style="margin:4px 0;font-size:12px;">`;
          html += `<span style="color:#666;">WME:</span> <span style="color:#dc3545;text-decoration:line-through;">${escapeHtml(wmeStreetName)}</span><br/>`;
          html += `<span style="color:#666;">База:</span> <b style="color:#155724;">${escapedSuggested}</b>`;
          html += `</div>`;
          html += `<div style="display:flex;gap:6px;margin-top:6px;">`;
          html += `<button class="wz-button update-street-btn" data-street="${escapedSuggested}" style="font-size:11px;padding:2px 8px;">✓ Використати</button>`;
          html += `<button class="copy-street-btn" data-street="${escapedSuggested}" style="font-size:11px;padding:2px 8px;background:#f8f8f8;border:1px solid #ccc;border-radius:3px;cursor:pointer;">📋 Копія</button>`;
          html += `</div>`;
          html += `</div>`;
        }
      }

      html += `<div style="font-size:12px;margin-bottom:4px;"><b>Вулиці в районі:</b></div>`;
      html += `<div style="max-height:150px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;background:#fafafa;">`;

      sorted.forEach(([name, _count], index) => {
        const isMatch = name === wmeStreetName;
        const isSuggestion = name === suggestedMatch;
        const escapedName = escapeHtml(name);

        let rowStyle = 'padding:4px 8px;font-size:11px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;';
        if (isMatch) rowStyle += 'background:#d4edda;';
        else if (isSuggestion) rowStyle += 'background:#fff3cd;';
        else if (index % 2 === 0) rowStyle += 'background:#f8f8f8;';

        html += `<div style="${rowStyle}">`;
        html += `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapedName}">`;
        if (isMatch) html += '✓ ';
        if (isSuggestion) html += '→ ';
        html += `${escapedName}</span>`;
        html += `<span style="margin-left:8px;white-space:nowrap;display:flex;align-items:center;gap:4px;">`;
        const btnStyle = isMatch
          ? 'padding:1px 4px;font-size:10px;cursor:default;border:1px solid #ccc;border-radius:2px;background:#e9e9e9;color:#999;'
          : 'padding:1px 4px;font-size:10px;cursor:pointer;border:1px solid #28a745;border-radius:2px;background:#d4edda;color:#155724;';
        html += `<button class="update-street-btn" data-street="${escapedName}" style="${btnStyle}" title="${isMatch ? 'Вже встановлено' : 'Використати'}">${isMatch ? '✓' : '→'}</button>`;
        html += `<button class="copy-street-btn" data-street="${escapedName}" style="padding:1px 4px;font-size:10px;cursor:pointer;border:1px solid #ccc;border-radius:2px;background:#fff;" title="Копіювати">📋</button>`;
        html += `</span>`;
        html += `</div>`;
      });

      html += `</div>`;
      html += `<div style="font-size:10px;color:#888;margin-top:4px;">→ = застосувати назву • 📋 = копіювати</div>`;

      streetAnalysisDiv.innerHTML = html;
      streetAnalysisDiv.style.display = 'block';

      // Add click handlers for copy buttons
      streetAnalysisDiv.querySelectorAll('.copy-street-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const streetName = btn.getAttribute('data-street');
          copyToClipboard(streetName);
        });
      });

      // Add click handlers for update buttons
      streetAnalysisDiv.querySelectorAll('.update-street-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const streetName = btn.getAttribute('data-street');

          const currentWmeStreet = getWmeStreetName();
          if (currentWmeStreet === streetName) {
            toast('Назва вулиці вже встановлена', 'info');
            return;
          }

          updateSegmentStreetName(streetName, () => {
            const newStreetId = streets[streetName];
            if (newStreetId) {
              currentStreetId = newStreetId;

              if (streetNameSpan && currentStreetDiv) {
                streetNameSpan.textContent = streetName;
                currentStreetDiv.style.display = 'block';
              }
            }

            setTimeout(() => {
              analyzeStreetMatches();
              applyFeatureFilter();
            }, 100);
          });
        });
      });
    };

    function onSelectionChanged() {
      if (!lastFeatures.length) return;

      const selectedSegments = getSelectedSegments();
      if (selectedSegments.length === 0) {
        return;
      }

      const selectedStreetIds = new Set();

      selectedSegments.forEach(seg => {
        const psid = seg.primaryStreetId;
        if (psid && psid > 0) selectedStreetIds.add(psid);
        (seg.alternateStreetIds || []).forEach(id => {
          if (id && id > 0) selectedStreetIds.add(id);
        });
      });

      if (selectedStreetIds.size === 0) {
        currentStreetId = null;
        if (streetNameSpan && currentStreetDiv) {
          streetNameSpan.textContent = '—';
          currentStreetDiv.style.display = 'none';
        }
        applyFeatureFilter();
        analyzeStreetMatches();
        return;
      }

      const selectedStreetNames = Array.from(selectedStreetIds)
        .map(id => wmeSDK.DataModel.Streets.getById({ streetId: id })?.name)
        .filter(Boolean);

      let newStreetId = null;
      let bestCount = -1;

      selectedStreetNames.forEach(name => {
        const sid = streets[name];
        if (!sid) return;
        const count = lastFeatures.reduce(
          (n, f) => n + (f.street === sid ? 1 : 0),
          0
        );
        if (count > bestCount) {
          bestCount = count;
          newStreetId = sid;
        }
      });

      if (!newStreetId) {
        currentStreetId = null;
        if (streetNameSpan && currentStreetDiv) {
          streetNameSpan.textContent = '—';
          currentStreetDiv.style.display = 'none';
        }
        applyFeatureFilter();
        analyzeStreetMatches();
        return;
      }

      currentStreetId = newStreetId;

      if (streetNameSpan && currentStreetDiv && streetNames[currentStreetId]) {
        streetNameSpan.textContent = streetNames[currentStreetId];
        currentStreetDiv.style.display = 'block';
      }

      applyFeatureFilter();
      analyzeStreetMatches();
    }


    function handleMapClick(evt) {
      if (!userWantsLayerVisible || !lastFeatures.length) return;
      if (evt == null || evt.x == null || evt.y == null) return;

      const MAX_PIXELS_SQ = MAX_CLICK_DISTANCE_PX * MAX_CLICK_DISTANCE_PX;
      let bestFeature = null;
      let bestDistSq = Infinity;

      for (const f of lastFeatures) {
        if (f.lon == null || f.lat == null) continue;
        const fPx = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: f.lon, lat: f.lat } });
        if (!fPx) continue;
        const dx = fPx.x - evt.x;
        const dy = fPx.y - evt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= MAX_PIXELS_SQ && d2 < bestDistSq) {
          bestDistSq = d2;
          bestFeature = f;
        }
      }

      if (!bestFeature) return;
      onFeatureClick(bestFeature);
    }

    wmeSDK.Events.on({ eventName: 'wme-map-mouse-click', eventHandler: handleMapClick });

    function onFeatureClick(feature) {
      if (feature.processed) return;

      const streetName = streetNames[feature.street];
      const houseNumber = feature.number;

      let nearestSegment = findNearestSegment(feature, streetName, true);

      if (!nearestSegment) {
        nearestSegment = findNearestSegment(feature, streetName, false);

        if (!nearestSegment) {
          toast('Не знайдено поблизу сегмента', 'warning');
          return;
        }

        const nearestStreet = wmeSDK.DataModel.Streets.getById({ streetId: nearestSegment.primaryStreetId });
        const nearestStreetName = nearestStreet?.name || 'Unknown';

        if (!confirm(`Вулиця "${streetName}" не знайдена.\n\nДодати номер до "${nearestStreetName}"?`)) {
          return;
        }
      }

      wmeSDK.Editing.setSelection({ selection: { ids: [nearestSegment.id], objectType: 'segment' } });

      try {
        wmeSDK.DataModel.HouseNumbers.addHouseNumber({
          number: houseNumber,
          point: { type: 'Point', coordinates: [feature.lon, feature.lat] },
          segmentId: nearestSegment.id
        });

        feature.userAdded = true;
        feature.processed = true;
        feature.conflict = false;
        applyFeatureFilter();

        console.log('[UA-HN] Додано номер будинку', houseNumber);
        toast(`Додано номер ${houseNumber} 🏠`, 'success');
      } catch (err) {
        console.error('[UA-HN] Помилка додавання номера:', err);
        toast('Помилка додавання номера будинку', 'error');
      }
    }

    function findNearestSegment(feature, streetName, matchName) {
      const point = { x: feature.lon, y: feature.lat };
      const allSegments = wmeSDK.DataModel.Segments.getAll();
      let candidateSegments = allSegments;

      if (matchName) {
        const matchingStreetIds = wmeSDK.DataModel.Streets.getAll()
          .filter(street => street.name?.toLowerCase() === streetName.toLowerCase())
          .map(street => street.id);

        if (matchingStreetIds.length === 0) {
          return null;
        }

        candidateSegments = allSegments.filter(segment => {
          const primaryMatch = matchingStreetIds.includes(segment.primaryStreetId);
          const altMatch = (segment.alternateStreetIds || []).some(id => matchingStreetIds.includes(id));
          return primaryMatch || altMatch;
        });
      }

      if (candidateSegments.length === 0) {
        return null;
      }

      let nearestSegment = null;
      let minDistance = Infinity;

      candidateSegments.forEach(segment => {
        const coords = segment.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return;
        const distance = pointToLineDistance(point, coords);
        if (distance < minDistance) {
          minDistance = distance;
          nearestSegment = segment;
        }
      });

      return nearestSegment;
    }

    function pointToLineDistance(point, coords) {
      const px = point.x;
      const py = point.y;
      let minDist = Infinity;
      for (let i = 0; i < coords.length - 1; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[i + 1];
        const dist = pointToSegmentDistance(px, py, x1, y1, x2, y2);
        if (dist < minDist) minDist = dist;
      }
      return minDist;
    }

    function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;

      if (lengthSquared === 0) {
        const dpx = px - x1;
        const dpy = py - y1;
        return Math.sqrt(dpx * dpx + dpy * dpy);
      }

      let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
      t = Math.max(0, Math.min(1, t));

      const closestX = x1 + t * dx;
      const closestY = y1 + t * dy;

      const dpx = px - closestX;
      const dpy = py - closestY;
      return Math.sqrt(dpx * dpx + dpy * dpy);
    }

    const loading = document.createElement('div');
    loading.style.position = 'absolute';
    loading.style.bottom = '35px';
    loading.style.width = '100%';
    loading.style.pointerEvents = 'none';
    loading.style.display = 'none';
    loading.innerHTML =
      '<div style="margin:0 auto; max-width:300px; text-align:center; background:rgba(0, 0, 0, 0.5); color:white; border-radius:3px; padding:5px 15px;"><i class="fa fa-pulse fa-spinner"></i> Завантаження адрес...</div>';
    document.getElementById('map').appendChild(loading);

    wmeSDK.Sidebar.registerScriptTab().then(({ tabLabel, tabPane }) => {
      tabLabel.innerText = 'UA-HN';
      tabLabel.title = 'Швидкий імпорт номерів (Україна)';

      tabPane.innerHTML = `
        <div id="qhnua-pane" style="padding:10px;">
          <h2 style="margin-top:0;">Швидкий імпорт 🇺🇦</h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px 0;">
            <button id="hn-load" class="wz-button"><span id="hn-load-label">Завантажити вулицю</span> <kbd style="margin-left:6px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(0,0,0,0.08);border-radius:3px;padding:2px 5px;color:#555;">Alt+Shift+L</kbd></button>
            <button id="hn-clear" class="wz-button wz-button--secondary">Очистити <kbd style="margin-left:6px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(0,0,0,0.08);border-radius:3px;padding:2px 5px;color:#555;">Alt+Shift+K</kbd></button>
          </div>
          <div id="hn-current-street" style="margin:8px 0;padding:8px;background:#f0f0f0;border-radius:4px;font-size:13px;display:none;">
            <b>Вибрана вулиця WME:</b> <span id="hn-street-name" style="color:#2a7;font-weight:bold;">—</span>
          </div>
          <div id="hn-street-analysis" style="margin:8px 0;display:none;"></div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <wz-checkbox id="hn-toggle">Показати точки</wz-checkbox>
            <wz-checkbox id="qhnua-missing">Тільки відсутні</wz-checkbox>
            <wz-checkbox id="qhnua-selected-only">Обрана вулиця</wz-checkbox>
            <wz-checkbox id="qhnua-navpoints">Показати HN NavPoints</wz-checkbox>
            <span style="font-size:12px;">Радіус (м): <input id="qhnua-buffer" type="number" min="0" step="50" style="width:80px;margin-left:6px"></span>
          </div>
          <div id="hn-status" style="margin-top:10px;font-size:12px;color:#666;line-height:1.4;">
            <b>Інструкція</b><br/>
            1) Вибрати сегмент • 2) Натиснути "Завантажити вулицю" • 3) <b>Клікнути номер на карті для додавання</b><br/>
            Зелений = обрана вулиця • Помаранчевий = інші вулиці • Червоний = можлива помилка • Напівпрозорий = вже в WME
          </div>
        </div>
      `;

      const btnLoad      = tabPane.querySelector('#hn-load');
      const btnLoadLabel = tabPane.querySelector('#hn-load-label');
      const btnClear     = tabPane.querySelector('#hn-clear');
      const chkVis = tabPane.querySelector('#hn-toggle');
      chkMissing = tabPane.querySelector('#qhnua-missing');
      chkSelectedOnly = tabPane.querySelector('#qhnua-selected-only');
      const chkNavPoints = tabPane.querySelector('#qhnua-navpoints');
      const bufferEl   = tabPane.querySelector('#qhnua-buffer');
      const statusDiv  = tabPane.querySelector('#hn-status');

      currentStreetDiv = tabPane.querySelector('#hn-current-street');
      streetNameSpan = tabPane.querySelector('#hn-street-name');
      streetAnalysisDiv = tabPane.querySelector('#hn-street-analysis');

      const isChecked  = (el) => el?.hasAttribute('checked');
      const setChecked = (el, v) => v ? el.setAttribute('checked', '') : el.removeAttribute('checked');

      bufferEl.value = String(LS.getBuffer());
      if (LS.getLayerVisible()) {
        setChecked(chkVis, true);
        userWantsLayerVisible = true;
        updateLayerVisibility();
      }
      if (LS.getSelectedOnly()) {
        setChecked(chkSelectedOnly, true);
      }
      setChecked(chkNavPoints, LS.getNavPoints());

      bufferEl.addEventListener('change', () => {
        const val = Number(bufferEl.value);
        if (!Number.isFinite(val) || val < 0) {
          bufferEl.value = String(LS.getBuffer());
          return;
        }
        LS.setBuffer(val);
      });

      chkVis.addEventListener('click', () => {
        const on = isChecked(chkVis);
        setChecked(chkVis, !on);
        userWantsLayerVisible = !on;
        LS.setLayerVisible(!on);
        updateLayerVisibility();
      });

      chkMissing.addEventListener('click', () => {
        setChecked(chkMissing, !isChecked(chkMissing));
        applyFeatureFilter();
      });

      chkSelectedOnly.addEventListener('click', () => {
        const newState = !isChecked(chkSelectedOnly);
        setChecked(chkSelectedOnly, newState);
        LS.setSelectedOnly(newState);
        applyFeatureFilter();
      });

      async function loadSelectedStreet() {
        if (isLoading) return;
        isLoading = true;
        const myLoadId = ++currentLoadId;
        btnLoad.disabled = true;
        btnLoadLabel.textContent = 'Завантаження…';

        if (lastSdkFeatureIds.length) {
          wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
          lastSdkFeatureIds = [];
        }
        streets = {};
        streetNames = {};
        currentStreetId = null;
        lastFeatures = [];
        streetAnalysisDiv.style.display = 'none';

        await updateLayer(statusDiv, myLoadId).catch(err => console.warn('UA-HN updateLayer:', err));

        // Skip post-load side effects if user clicked Clear (or started another Load) mid-fetch
        if (myLoadId === currentLoadId) {
          userWantsLayerVisible = true;
          setChecked(chkVis, true);
          LS.setLayerVisible(true);
          updateLayerVisibility();
        }

        btnLoad.disabled = false;
        btnLoadLabel.textContent = 'Завантажити вулицю';
        isLoading = false;
      }

      btnLoad.addEventListener('click', loadSelectedStreet);

      function clearLayer() {
        currentLoadId++; // invalidate any in-flight load so its results are discarded
        if (lastSdkFeatureIds.length) {
          wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
          lastSdkFeatureIds = [];
        }
        userWantsLayerVisible = false;
        wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: false });
        setChecked(chkVis, false);
        LS.setLayerVisible(false);
        streets = {};
        streetNames = {};
        currentStreetId = null;
        lastFeatures = [];
        currentStreetDiv.style.display = 'none';
        streetAnalysisDiv.style.display = 'none';
        statusDiv.innerHTML = `<b>Інструкція</b><br/>
          1) Вибрати сегмент • 2) Натиснути "Завантажити вулицю" • 3) <b>Клікнути номер на карті для додавання</b><br/>
          Зелений = обрана вулиця • Помаранчевий = інші вулиці • Червоний = можлива помилка • Напівпрозорий = вже в WME`;
      }

      btnClear.addEventListener('click', clearLayer);

      applyFeatureFilter = function () {
        const onlyMissing  = chkMissing?.hasAttribute('checked');
        const selectedOnly = chkSelectedOnly?.hasAttribute('checked');
        const visible = lastFeatures.filter(feat => {
          if (onlyMissing && feat.processed) return false;
          if (selectedOnly && currentStreetId && feat.street !== currentStreetId) return false;
          return true;
        });
        if (lastSdkFeatureIds.length) {
          wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
        }
        const visibleSdk = visible.map((feat, i) => ({
          type: 'Feature',
          id: `qhnua-${i}`,
          geometry: { type: 'Point', coordinates: [feat.lon, feat.lat] },
          properties: {
            number: feat.number,
            street: feat.street,
            processed: feat.processed,
            conflict: feat.conflict,
            isSelectedStreet: feat.street === currentStreetId
          }
        }));
        wmeSDK.Map.addFeaturesToLayer({ layerName: SDK_LAYER_NAME, features: visibleSdk });
        lastSdkFeatureIds = visibleSdk.map(f => f.id);
      };

      async function recalculateFeatureStates() {
        if (!lastFeatures.length) return;

        const selectionHNMap = await getVisibleHNsByStreet();

        lastFeatures.forEach(feat => {
          const { number: hn, street: streetId, lon, lat } = feat;
          if (!hn || !streetId) return;

          const entry = selectionHNMap.get(streetId);
          const processed = (entry?.set.has(hn) === true) || feat.userAdded === true;
          const conflict = !processed && hasConflict(hn, lon, lat, entry);

          feat.processed = processed;
          feat.conflict = conflict;
        });

        applyFeatureFilter();
      }

      function setupHouseNumberEventListeners() {
        const events = [
          'wme-house-number-added',
          'wme-house-number-deleted',
          'wme-house-number-moved',
          'wme-house-number-updated'
        ];

        events.forEach(eventName => {
          wmeSDK.Events.on({
            eventName,
            eventHandler: () => {
              if (lastFeatures.length > 0) {
                recalculateFeatureStates().catch(err => console.warn('[UA-HN] recalculate failed:', err));
              }
            }
          });
        });

        wmeSDK.Events.on({
          eventName: 'wme-map-data-loaded',
          eventHandler: () => {
            if (lastFeatures.length > 0) {
              recalculateFeatureStates().catch(err => console.warn('[UA-HN] recalculate failed:', err));
            }
          }
        });

        // Listen for segment edits (like street name changes) to refresh UI
        wmeSDK.Events.on({
          eventName: 'wme-after-edit',
          eventHandler: () => {
            if (lastFeatures.length > 0) {
              analyzeStreetMatches();
              applyFeatureFilter();
            }
          }
        });
      }

      setupHouseNumberEventListeners();

      function setupNavPoints(tabPane) {
        const chkNavPoints = tabPane.querySelector('#qhnua-navpoints');
        if (!chkNavPoints) return;

        let lastNavIds = [];
        let currentRenderId = 0;
        let renderTimer = null;

        wmeSDK.Map.addLayer({
          layerName: SDK_NAVPOINTS_LAYER_NAME,
          zIndexing: true,
          styleContext: {
            getColor: ({ feature }) => {
              const p = feature.properties;
              if (p.forced)  return p.touched ? '#ff9933' : '#ff3333';
              return p.touched ? '#ffffff' : '#ffdd00';
            },
            getLabel: ({ feature }) => String(feature.properties.number ?? '')
          },
          styleRules: [
            {
              predicate: (featureProperties) => featureProperties.kind === 'line',
              style: {
                strokeColor: '${getColor}',
                strokeWidth: 2,
                strokeOpacity: 0.9,
                strokeDashstyle: 'dash',
                fill: false
              }
            },
            {
              predicate: (featureProperties) => featureProperties.kind === 'label',
              style: {
                label: '${getLabel}',
                fontColor: '#111111',
                fontSize: '12px',
                fontWeight: 'bold',
                fontFamily: '"Open Sans", Arial, sans-serif',
                labelOutlineColor: '${getColor}',
                labelOutlineWidth: 3,
                labelOutlineOpacity: 1,
                pointRadius: 0,
                stroke: false,
                fill: false
              }
            }
          ]
        });

        function clearNavLayer() {
          if (!lastNavIds.length) return;
          try {
            wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_NAVPOINTS_LAYER_NAME, featureIds: lastNavIds });
          } catch (e) {
            console.debug('[UA-HN] NavPoints clearLayer:', e);
          }
          lastNavIds = [];
        }

        async function renderNavPoints() {
          if (!LS.getNavPoints()) { clearNavLayer(); return; }
          if (wmeSDK.Map.getZoomLevel() < 18) { clearNavLayer(); return; }

          const myRenderId = ++currentRenderId;

          const segIds = wmeSDK.DataModel.Segments.getAll()
            .filter(s => s.hasHouseNumbers)
            .map(s => s.id);

          if (!segIds.length) { clearNavLayer(); return; }

          let allHns;
          try {
            allHns = await wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({ segmentIds: segIds });
          } catch (err) {
            console.warn('[UA-HN] NavPoints fetch failed:', err);
            return;
          }

          if (myRenderId !== currentRenderId) return;

          const features = [];
          for (const hn of allHns) {
            const touched = hn.updatedBy != null;
            const forced = hn.isForced === true;
            if (hn.fractionPoint?.coordinates && hn.geometry?.coordinates) {
              features.push({
                type: 'Feature',
                id: `navp-${hn.id}-line`,
                geometry: {
                  type: 'LineString',
                  coordinates: [hn.fractionPoint.coordinates, hn.geometry.coordinates]
                },
                properties: { kind: 'line', touched, forced }
              });
            }
            if (hn.geometry?.coordinates) {
              features.push({
                type: 'Feature',
                id: `navp-${hn.id}-label`,
                geometry: hn.geometry,
                properties: { kind: 'label', number: hn.number, touched, forced }
              });
            }
          }

          if (lastNavIds.length) {
            try {
              wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_NAVPOINTS_LAYER_NAME, featureIds: lastNavIds });
            } catch (e) {
              console.debug('[UA-HN] NavPoints swap-clear:', e);
            }
          }

          if (features.length) {
            try {
              wmeSDK.Map.addFeaturesToLayer({ layerName: SDK_NAVPOINTS_LAYER_NAME, features });
            } catch (e) {
              console.warn('[UA-HN] NavPoints addFeaturesToLayer:', e);
              lastNavIds = [];
              return;
            }
          }

          lastNavIds = features.map(f => f.id);
        }

        function scheduleRender() {
          if (renderTimer) clearTimeout(renderTimer);
          renderTimer = setTimeout(() => {
            renderTimer = null;
            renderNavPoints().catch(err => console.warn('[UA-HN] NavPoints render failed:', err));
          }, 300);
        }

        chkNavPoints.addEventListener('click', () => {
          const on = !isChecked(chkNavPoints);
          setChecked(chkNavPoints, on);
          LS.setNavPoints(on);
          if (on) scheduleRender();
          else clearNavLayer();
        });

        if (LS.getNavPoints()) scheduleRender();

        const NAVPOINTS_TRIGGER_EVENTS = [
          'wme-map-zoom-changed',
          'wme-map-move-end',
          'wme-house-number-added',
          'wme-house-number-deleted',
          'wme-house-number-moved',
          'wme-house-number-updated',
          'wme-map-data-loaded'
        ];
        NAVPOINTS_TRIGGER_EVENTS.forEach(eventName => {
          wmeSDK.Events.on({
            eventName,
            eventHandler: () => {
              if (LS.getNavPoints()) scheduleRender();
            }
          });
        });
      }

      // Register keyboard shortcuts
      ['qhnua-load', 'qhnua-clear'].forEach(id => {
        try { wmeSDK.Shortcuts.deleteShortcut({ shortcutId: id }); } catch (_) {}
      });
      [
        { shortcutId: 'qhnua-load',  shortcutKeys: 'AS+l', description: 'UA-HN: Завантажити вибрану вулицю', callback: loadSelectedStreet },
        { shortcutId: 'qhnua-clear', shortcutKeys: 'AS+k', description: 'UA-HN: Очистити',                callback: clearLayer }
      ].forEach(spec => {
        try { wmeSDK.Shortcuts.createShortcut(spec); }
        catch (e) { console.warn('UA-HN: не вдалося зареєструвати хоткей', spec.shortcutId, e); }
      });

      function updateLayer(statusDiv, loadId) {
        return new Promise((resolve) => {
          const selectedSegments = getSelectedSegments();
          if (selectedSegments.length === 0) {
            toast('Спочатку виберіть сегмент.', 'warning');
            statusDiv.textContent = 'Не вибрано сегмент.';
            resolve();
            return;
          }

          loading.style.display = null;

          // Compute bounding box of selected segments to get center
          let minLon = Infinity, maxLon = -Infinity;
          let minLat = Infinity, maxLat = -Infinity;
          selectedSegments.forEach(seg => {
            const coords = seg.geometry?.coordinates;
            if (!Array.isArray(coords)) return;
            coords.forEach(pt => {
              const lon = pt[0], lat = pt[1];
              if (lon < minLon) minLon = lon;
              if (lon > maxLon) maxLon = lon;
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
            });
          });

          if (minLon === Infinity) {
            loading.style.display = 'none';
            statusDiv.textContent = 'Немає геометрії для вибраного сегмента.';
            resolve();
            return;
          }

          // Calculate center of bbox
          const centerLat = (minLat + maxLat) / 2;
          const centerLon = (minLon + maxLon) / 2;
          const zoom = wmeSDK.Map.getZoomLevel();
          // Radius based on zoom (same as UA-address-data script)
          let radius = 400;
          if (zoom === 16) radius = 1000;
          else if (zoom === 17) radius = 600;
          const userBuffer = LS.getBuffer();
          radius = Math.max(radius, userBuffer);

          Promise.all([
            fetchAddresses(centerLat, centerLon, radius),
            getVisibleHNsByStreet()
          ])
            .then(([apiResult, selectionHNMap]) => {
              // Bail out if user clicked Clear (or started a newer load) while the fetch was in flight
              if (loadId !== currentLoadId) {
                loading.style.display = 'none';
                resolve();
                return;
              }

              const { features: apiFeatures, streets: newStreets, streetNames: newStreetNames } = apiResult;
              streets = newStreets;
              streetNames = newStreetNames;

              const features = [];

              for (const item of apiFeatures) {
                if (!item.lat || !item.lon) continue;

                const entry = selectionHNMap.get(item.street);
                const processed = entry?.set.has(item.number) === true;
                const conflict = !processed && hasConflict(item.number, item.lon, item.lat, entry);

                features.push({
                  number: item.number,
                  street: item.street,
                  processed,
                  conflict,
                  lon: item.lon,
                  lat: item.lat
                });
              }

              const allStreetIds = new Set();
              selectedSegments.forEach(seg => {
                (seg.alternateStreetIds || []).forEach(id => allStreetIds.add(id));
                if (seg.primaryStreetId) allStreetIds.add(seg.primaryStreetId);
              });
              const selectedNames = [...allStreetIds]
                .map(id => wmeSDK.DataModel.Streets.getById({ streetId: id })?.name)
                .filter(Boolean);

              let best = null, bestCount = -1;
              selectedNames.forEach(name => {
                const sid = streets[name];
                if (!sid) return;
                const count = features.reduce((n,f)=> n + (f.street === sid ? 1 : 0), 0);
                if (count > bestCount) { best = sid; bestCount = count; }
              });

              currentStreetId = best || null;

              if (!features.length) {
                loading.style.display = 'none';
                statusDiv.textContent = 'Не знайдено адрес у цьому районі.';
                resolve();
                return;
              }

              lastFeatures = features;

              if (currentStreetId && streetNames[currentStreetId]) {
                streetNameSpan.textContent = streetNames[currentStreetId];
                currentStreetDiv.style.display = 'block';
              } else {
                currentStreetDiv.style.display = 'none';
              }

              if (lastSdkFeatureIds.length) {
                wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
                lastSdkFeatureIds = [];
              }

              applyFeatureFilter();
              analyzeStreetMatches();

              loading.style.display = 'none';
              const conflictCount = features.filter(f => f.conflict).length;
              const processedCount = features.filter(f => f.processed).length;
              statusDiv.innerHTML = `Завантажено ${features.length} адрес.<br/>` +
                `<b>Клікніть на номер на карті, щоб додати!</b><br/>` +
                `Зелений = обрана вулиця • Помаранчевий = інші • Червоний = можлива помилка<br/>` +
                `<span style="font-size:11px;color:#666;">` +
                `${processedCount} вже в WME ${conflictCount > 0 ? `• ${conflictCount} збігів` : ''}` +
                `</span>`;
              resolve();
            })
            .catch(err => {
              console.error('[UA-HN] Помилка API:', err);
              loading.style.display = 'none';
              if (loadId === currentLoadId) {
                statusDiv.textContent = 'Помилка отримання даних. Перевірте консоль.';
                toast('Помилка отримання даних адрес.', 'error');
              }
              resolve();
            });
        });
      }

      // Visible HNs grouped by normalized street name (primary + alternate)
      async function getVisibleHNsByStreet() {
        const map = new Map();
        const ext = wmeSDK.Map.getMapExtent();
        const [lonMin, latMin, lonMax, latMax] = Array.isArray(ext)
          ? ext
          : [ext.lonMin, ext.latMin, ext.lonMax, ext.latMax];

        const segIds = wmeSDK.DataModel.Segments.getAll()
          .filter(s => s.hasHouseNumbers)
          .map(s => s.id);
        const allHns = segIds.length
          ? await wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({ segmentIds: segIds })
          : [];

        allHns.forEach(hn => {
          const seg = wmeSDK.DataModel.Segments.getById({ segmentId: hn.segmentId });
          if (!seg) return;

          const streetIdSet = new Set();
          if (seg.primaryStreetId) {
            streetIdSet.add(seg.primaryStreetId);
          }
          (seg.alternateStreetIds || []).forEach(id => {
            if (id) streetIdSet.add(id);
          });
          if (!streetIdSet.size) return;

          const g = getHNGeometry(hn);
          let x, y;
          if (g && typeof g.x === 'number' && typeof g.y === 'number') {
            x = g.x;
            y = g.y;
          }
          if (x == null || y == null || x < lonMin || x > lonMax || y < latMin || y > latMax) return;

          const numRaw = String(hn.number).trim();

          streetIdSet.forEach(streetId => {
            const st = wmeSDK.DataModel.Streets.getById({ streetId });
            const name = st?.name;
            if (!name) return;

            const sidNorm = normalizeStreetName(name);

            let entry = map.get(sidNorm);
            if (!entry) {
              entry = { set: new Set(), items: [] };
              map.set(sidNorm, entry);
            }

            entry.set.add(numRaw);
            entry.items.push({ num: numRaw, x, y });
          });
        });

        return map;
      }

      setupNavPoints(tabPane);
    });
  }

  (unsafeWindow || window).SDK_INITIALIZED.then(() => {
    wmeSDK = getWmeSdk({ scriptId: 'quick-hn-ua-importer', scriptName: 'Quick HN Importer (UA)' });
    wmeSDK.Events.once({ eventName: 'wme-ready' }).then(() => {
      const required = [
        'DataModel.Segments.getAll',
        'DataModel.Segments.getById',
        'DataModel.Streets.getAll',
        'DataModel.Streets.getById',
        'DataModel.Streets.getStreet',
        'DataModel.HouseNumbers.fetchHouseNumbers',
        'DataModel.HouseNumbers.addHouseNumber',
        'DataModel.Segments.updateAddress',
        'DataModel.Streets.addStreet',
        'Editing.setSelection',
        'Editing.getSelection',
        'Map.addLayer',
        'Map.addFeaturesToLayer',
        'Map.removeFeaturesFromLayer',
        'Map.setLayerVisibility',
        'Map.getZoomLevel',
        'Map.getMapExtent',
        'Map.getMapPixelFromLonLat'
      ];
      const missing = required.filter(path => {
        const parts = path.split('.');
        let cur = wmeSDK;
        for (const part of parts) { cur = cur?.[part]; if (cur == null) return true; }
        return false;
      });
      if (missing.length) {
        console.error('[UA-HN] WME SDK відсутні необхідні API:', missing);
        toast(`UA-HN: WME SDK не має ${missing.length} необхідних API. Див. консоль.`, 'error');
        return;
      }
      init();
    });
  });
})();