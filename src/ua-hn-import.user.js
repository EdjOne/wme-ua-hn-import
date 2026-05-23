// ==UserScript==
// @name         WME UA-RPP
// @namespace    https://github.com/EdjOne/house-number
// @version      1.8.34
// @description  Швидкий імпорт RPP UA 🇺🇦
// @author       EdjOne, Sapozhnik, Hermes Agent AI
// @downloadURL  https://github.com/EdjOne/wme-ua-hn-import/raw/refs/heads/main/src/ua-hn-import.user.js
// @updateURL    https://github.com/EdjOne/wme-ua-hn-import/raw/refs/heads/main/src/ua-hn-import.user.js
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PHBvbHlnb24gZmlsbD0iI2ViOTMzYiIgcG9pbnRzPSI0OCwwIDAsOTYgOTYsOTYiLz48L3N2Zz4=
// @icon64       data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PHBvbHlnb24gZmlsbD0iI2ViOTMzYiIgcG9pbnRzPSI0OCwwIDAsOTYgOTYsOTYiLz48L3N2Zz4=
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/*
// @match        https://livemap.waze.com/*
// @match        https://www.waze.com/*
// @exclude      https://www.waze.com/user/editor*
// @connect      stat.waze.com.ua
// @connect      api.visicom.ua
// @connect      overpass.kumi.systems
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM
// @license      MIT
// @noframes
// ==/UserScript==

/*
 * Ukrainian adaptation based on:
 * - https://github.com/zigapovhe/wme-sl-hn-import (Slovenia version)
 * - https://github.com/waze-ua/WME-UA-address-data (UA address polygons)
 *
 * Data source: Держреєстр (stat.waze.com.ua) — Waze Ukraine address database
 * Projection: WGS84 (EPSG:4326) — no reprojection needed
 */

/* global I18n, getWmeSdk, unsafeWindow */

(function () {
  'use strict';

  let wmeSDK;
  const SDK_LAYER_NAME = 'qhnua-sdk';
  const MAX_CLICK_DISTANCE_PX = 25;
  const MAX_RPP_CONFLICT_DISTANCE = 0.001; // ~111 meters at 49° latitude

  const UA_BUFFER_DEFAULT = 200; // reduced radius to avoid timeouts
  const OVERPASS_API = 'https://overpass.kumi.systems/api/interpreter';
  const OVERPASS_TIMEOUT = 60000;



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
    'спуск': 'узвіз'
  };

  // Full street type names to remove (for suffix stripping: "Успенська вулиця" → "Успенська")
  const STREET_TYPES_FULL = [
    'вулиця', 'провулок', 'проспект', 'бульвар', 'площа', 'майдан',
    'узвіз', 'набережна', 'шосе', 'тупик', 'проїзд'
  ];

  

  const LS = {
    getBuffer()       { return Number(localStorage.getItem('qhnua-buffer') ?? '500'); },
    setBuffer(v)      { localStorage.setItem('qhnua-buffer', String(v)); },
    getLayerVisible() { return localStorage.getItem('qhnua-layer-visible') === '1'; },
    setLayerVisible(v){ localStorage.setItem('qhnua-layer-visible', v ? '1' : '0'); },
    getSelectedOnly() { return localStorage.getItem('qhnua-selected-only') === '1'; },
    setSelectedOnly(v){ localStorage.setItem('qhnua-selected-only', v ? '1' : '0'); },
    getNoDuplicates() { return localStorage.getItem('qhnua-no-duplicates') === '1'; },
    setNoDuplicates(v){ localStorage.setItem('qhnua-no-duplicates', v ? '1' : '0'); },
    getVisicomKey()   { return localStorage.getItem('qhnua-visicom-key') || ''; },
    setVisicomKey(v)  { localStorage.setItem('qhnua-visicom-key', v); },
    getSource()       { return localStorage.getItem('qhnua-source') || 'waze'; },
    setSource(v)      { localStorage.setItem('qhnua-source', v); },
    getLockRank2()    { return localStorage.getItem('qhnua-lock-rank2') === '1'; },
    setLockRank2(v)   { localStorage.setItem('qhnua-lock-rank2', v ? '1' : '0'); },
    getSources()      { try { return JSON.parse(localStorage.getItem('qhnua-sources') || '["waze"]'); } catch { return ['waze']; } },
    setSources(v)     { localStorage.setItem('qhnua-sources', JSON.stringify(v)); }
  };

  const toast = (msg, type = 'info') => {
    try {
      if (wmeSDK?.Notifications?.show) {
        wmeSDK.Notifications.show({ text: msg, type, timeout: 3500 });
      } else {
        console.info(`[UA-RPP] ${msg}`);
      }
    } catch (_) {
      console.info(`[UA-RPP] ${msg}`);
    }
  };

  // Check for existing venue with same houseNumber + streetId (RPP duplicate detection)
  function hasDuplicate(houseNumber, streetId, isResidential = true) {
    const venues = wmeSDK.DataModel.Venues.getAll();
    for (const venue of venues) {
      const addr = wmeSDK.DataModel.Venues.getAddress({ venueId: venue.id });
      if (
        venue.isResidential === isResidential &&
        addr?.street?.id === streetId &&
        addr?.houseNumber === houseNumber
      ) {
        return true;
      }
    }
    return false;
  }

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
    let normalized = String(name).trim();

    // Now lowercase and expand abbreviations
    normalized = normalized.toLowerCase();

    // Remove street type prefixes (вул., пров., просп., etc.) from start of string
    for (const abbrev of Object.keys(ABBREVIATIONS)) {
      const escapedAbbrev = abbrev.replace(/\./g, '\\.');
      const regex = new RegExp('^' + escapedAbbrev + '\\s*', 'i');
      normalized = normalized.replace(regex, '');
    }

    // Remove street type suffixes (пров., вул., просп. etc.) from end of string
    for (const abbrev of Object.keys(ABBREVIATIONS)) {
      const escapedAbbrev = abbrev.replace(/\./g, '\\.');
      const regex = new RegExp('\\s*' + escapedAbbrev + '$', 'i');
      normalized = normalized.replace(regex, '');
    }

    for (const [abbrev, full] of Object.entries(ABBREVIATIONS)) {
      const escapedAbbrev = abbrev.replace(/\./g, '\\.');
      const regex = new RegExp('(^|\\s)' + escapedAbbrev + '(?=\\s|$)', 'gi');
      normalized = normalized.replace(regex, '$1' + full);
    }

    // Remove full street type suffixes (вулиця, провулок etc.) from end AND start of string
    for (const type of STREET_TYPES_FULL) {
      const escapedType = type.replace(/\s/g, '\\s');
      // From end
      let regex = new RegExp('\\s+' + escapedType + '$', 'i');
      normalized = normalized.replace(regex, '');
      // From start
      regex = new RegExp('^' + escapedType + '\\s*', 'i');
      normalized = normalized.replace(regex, '');
    }

    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, ' ');

    return normalized;
  }

  function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

// Normalize house number: fix fractions and letter case
  // - Fix "7/ 1" → "7/1" (remove space before /)
  // - Fix incomplete fraction "2/" → "2/1"
  // - Letter numbers: uppercase Cyrillic except І, З, О → lowercase і, з, о
  // - No space between digit and letter: "2А" not "2 А"
  function normalizeHouseNumber(num) {
    if (!num) return num;
    let normalized = String(num).trim();
    
    // Fix fractions: "7/ 1" → "7/1" (space after / or before digit)
    normalized = normalized.replace(/\s*\/\s*/g, '/');
    
    // Fix incomplete fraction: "2/" → "2/1"
    normalized = normalized.replace(/\/$/, '/1');
    
    // Ensure no space between digit and letter: "2 А" → "2А"
    normalized = normalized.replace(/(\d)\s+([А-Яа-яІіЇїЄєҐґ])/g, '$1$2');
    
    // Uppercase Cyrillic letters, but І, З, О stay lowercase і, з, о
    // Only for letter suffix at the end (e.g., "51а" → "51А", "51з" stays "51з")
    normalized = normalized.replace(/([а-яіїєґ])$/g, (match) => {
      const lowerMap = { 'і': 'і', 'з': 'з', 'о': 'о' };
      return lowerMap[match] || match.toUpperCase();
    });
    
    return normalized;
  }

  function getSelectedSegments() {
    const sel = wmeSDK.Editing.getSelection();
    if (!sel || sel.objectType !== 'segment') return [];
    return sel.ids
      .map(id => wmeSDK.DataModel.Segments.getById({ segmentId: id }))
      .filter(Boolean);
  }

  // Check if a house number has a nearby RPP within threshold distance
  // Returns true if: different number nearby (conflict) OR same number nearby (already exists)
  function hasConflict(hn, wx, wy, entry) {
    if (!entry?.items?.length) return false;
    for (const it of entry.items) {
      if (!it || it.x == null || it.y == null) continue;
      const dx = wx - it.x, dy = wy - it.y;
      if (dx * dx + dy * dy <= MAX_RPP_CONFLICT_DISTANCE * MAX_RPP_CONFLICT_DISTANCE) {
        // Same number nearby = already exists on map
        // Different number nearby = conflict (too close)
        return true;
      }
    }
    return false;
  }


  // Fetch addresses from Waze Ukraine state register (stat.waze.com.ua)
  function fetchAddressesWaze(centerLat, centerLon, radius) {
    return new Promise((resolve, reject) => {
      const url = `https://stat.waze.com.ua/address_map/address_map.php?lat=${centerLat}&lon=${centerLon}&radius=${radius}`;

      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 30000,
        onload: function (response) {
          try {
            const data = JSON.parse(response.responseText);
            const polygons = data?.data?.polygons?.Default || [];

            const features = [];
            const streetNames = {};
            const streets = {};

            for (const item of polygons) {
              if (!item.center || typeof item.center !== 'string') continue;
              const center = item.center.split(';');
              const lat = parseFloat(center[0]);
              const lon = parseFloat(center[1]);
              if (isNaN(lat) || isNaN(lon)) continue;

              const nameParts = item.name.trim().split('\n').map(p => p.trim()).filter(p => p);

              // Robust parsing for address_map.php format:
              // Format example: "Одеська обл.\n Овідіопольський р-н\n с. Мізікевича\n ж/масив Ульянівка\n масив Радужний\n ділянка 32"
              // Last line contains house number (ділянка N, масив N, діл. N, буд. N, кв. N etc.)
              let city = '';
              let street = '';
              let houseNumber = '';
              let district = '';

// Find city (line starting with "с."/"м.", "село", or contains city name pattern)
              for (const part of nameParts) {
                // Match "с. Майори", "с.Майори", "м. Київ", "село Майори", "село Майори"
                const cityMatch = part.match(/^(с\.|м\.|село|місто)\s*([А-Яа-яІіЇїЄєҐґ'\\-\\s]+)|^(с|м|село|місто)\s*([А-Яа-яІіЇїЄєҐґ'\\-\\s]+)/i);
                if (cityMatch) {
                  city = (cityMatch[2] || cityMatch[4] || '').trim();
                  break;
                }
              }

              // Extract house number from last line (ділянка N, масив N, діл. N, буд. N, кв. N etc.)
              const lastLine = nameParts[nameParts.length - 1] || '';
// Normalize whitespace around fractions: "2/ 17" → "2/17"
              const normalizedLine = lastLine.replace(/\s*\/\s*/g, '/');
              // Skip "б/н" (без номера), "будинок", etc. - require actual number
              if (lastLine.includes('б/н') || lastLine.includes('без номера')) {
                continue;
              }
              const numMatch = normalizedLine.match(/(?:ділянка|масив|діл\.|буд\.|кв\.|№)?\s*(\d+(?:\/\d+)?[а-яА-Я]?)/i);
              if (numMatch) {
                houseNumber = normalizeHouseNumber(numMatch[1]);
              }

              // Extract street - look for вул. or пров. or use last available line before number
              for (let i = nameParts.length - 2; i >= 0; i--) {
                if (/^вул\.|^пров\./i.test(nameParts[i])) {
                  street = nameParts[i].replace(/^(вул\.|пров\.)/i, '').trim();
                  break;
                }
              }
              // If no street found, use second-to-last line as street (for масив/ділянка without вул.)
              if (!street && nameParts.length >= 2) {
                street = nameParts[nameParts.length - 2].replace(/^(с\.|м\.|ж\/?масив|масив)/i, '').trim();
              }

              // Extract district (line with "р-н")
              for (const part of nameParts) {
                if (part.includes('р-н')) {
                  district = part.replace('р-н', '').trim();
                  break;
                }
              }

              // For rural areas, we may have no street - use city name as street identifier
              if (!street && city) {
                street = city;
              }

              if (!houseNumber) continue;

              const normalizedRPP = normalizeHouseNumber(houseNumber);
              const streetId = normalizeStreetName(street);
              if (!streets[street]) {
                streets[street] = streetId;
                streetNames[streetId] = street;
              }

              features.push({
                number: normalizedRPP,
                street: streetId,
                streetRaw: street,
                houseNumberRaw: normalizedRPP,
                lat: lat,
                lon: lon,
                city: city,
                district: district,
                source: 'waze'
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
          reject(new Error('Waze API timeout'));
        }
      });
    });
  }

  // Fetch addresses from Visicom API
  function fetchAddressesVisicom(bounds) {
    return new Promise((resolve, reject) => {
      const apiKey = LS.getVisicomKey();
      if (!apiKey) {
        reject(new Error('API ключ Visicom не встановлено'));
        return;
      }

      // Using Visicom API 5.0 format (from wme-e50)
      const centerLat = (bounds.minLat + bounds.maxLat) / 2;
      const centerLon = (bounds.minLon + bounds.maxLon) / 2;
      const radius = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLon - bounds.minLon) / 2 * 111000;

      const url = `https://api.visicom.ua/data-api/5.0/uk/geocode.json`;
      const params = new URLSearchParams({
        key: apiKey,
        near: `${centerLon},${centerLat}`,
        categories: 'adr_address',
        radius: Math.round(radius),
        limit: '1000'
      }).toString();

      console.log('[Visicom] Request URL:', url + '?' + params);

      GM.xmlHttpRequest({
        method: 'GET',
        url: url + '?' + params,
        responseType: 'json',
        timeout: 30000,
        onload: function(response) {
          // Check HTTP status
          if (response.status >= 400) {
            console.error('[Visicom] HTTP error:', response.status, response.responseJSON);
            reject(new Error(`Visicom API error: ${response.status}`));
            return;
          }
          try {
            // responseType: 'json' → data в response.response
            const data = response.response || JSON.parse(response.responseText || '{}');
            const features = [];

            for (const feature of (data.features || [])) {
              const props = feature.properties || {};
              const coords = feature.geo_centroid?.coordinates || [];

              if (!props.name && !props.house_number) continue;

              const street = props.street_type ? `${props.street_type} ${props.street || ''}`.trim() : (props.street || '');
              const city = props.settlement || '';
              const streetId = normalizeStreetName(street);

              features.push({
                number: props.name || props.house_number || '',
                street: streetId,
                streetRaw: street,
                houseNumberRaw: props.name || props.house_number || '',
                city: city,
                lat: coords[1],
                lon: coords[0],
                source: 'visicom'
              });
            }

            console.log('[Visicom] Loaded', features.length, 'addresses');
            resolve({ features, streets: {}, streetNames: {} });
          } catch (e) {
            console.error('[Visicom] Parse error:', e, 'response:', response.responseText?.substring(0, 500));
            reject(e);
          }
        },
        onerror: function(err) {
          console.error('[Visicom] Network error:', err);
          reject(new Error('Visicom API error: network error'));
        },
        ontimeout: function() {
          reject(new Error('Visicom API timeout'));
        }
      });
    });
  }

  // Fetch addresses from OSM Overpass API
  function fetchAddressesOSM(centerLat, centerLon, radius) {
    return new Promise((resolve, reject) => {
      const query = `
        [out:json][timeout:60];
        (
          node["addr:housenumber"](around:${Math.round(radius)},${centerLat},${centerLon});
          way["addr:housenumber"](around:${Math.round(radius)},${centerLat},${centerLon});
        );
        out center;
      `;

      GM_xmlhttpRequest({
        method: 'POST',
        url: OVERPASS_API,
        timeout: OVERPASS_TIMEOUT,
        data: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        onload: function (response) {
          try {
            const data = JSON.parse(response.responseText);

            if (!data.elements || data.elements.length === 0) {
              resolve({ features: [], streets: {}, streetNames: {} });
              return;
            }

            const features = [];
            const streetNames = {};
            const streets = {};

            for (const el of data.elements) {
              const tags = el.tags || {};
              const street = tags['addr:street'] || tags['addr:full'];
              const houseNumber = tags['addr:housenumber'];

              if (!houseNumber || !street) continue;

              // Get coordinates (way has center, node has lat/lon)
              let lat, lon;
              if (el.type === 'way' && el.center) {
                lat = el.center.lat;
                lon = el.center.lon;
              } else {
                lat = el.lat;
                lon = el.lon;
              }

              if (lat == null || lon == null) continue;

              const streetId = normalizeStreetName(street);
              if (!streets[street]) {
                streets[street] = streetId;
                streetNames[streetId] = street;
              }

              features.push({
                number: String(houseNumber).toLowerCase(),
                street: streetId,
                streetRaw: street,
                houseNumberRaw: houseNumber,
                lat: lat,
                lon: lon,
                city: tags['addr:city'] || '',
                district: tags['addr:district'] || '',
                source: 'osm'
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
          reject(new Error('OSM Overpass API request timed out'));
        }
      });
    });
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
    
    // Last restriction reason when RPP cannot be added
    let lastRestriction = null;

    let applyFeatureFilter = () => {};

    try {
      I18n.translations[I18n.currentLocale()].layers.name['quick-rpp-ua-importer'] = 'Quick RPP Importer (UA)';
    } catch (_) {}

    wmeSDK.Map.addLayer({
      layerName: SDK_LAYER_NAME,
      zIndexing: true,
      styleContext: {
        getFillColor: ({ feature }) => {
          const p = feature.properties;
          if (p.conflict) return '#ff6666';
          // Цвета по источнику: OSM-оранж, Visicom-жёлтый, Waze-зеленый
          const colors = {
            'osm': '#eb933b',
            'visicom': '#ebe83b',
            'waze': '#4ad958'
          };
          const baseColor = colors[p.source] || '#4ad958';
          return p.isSelectedStreet ? '#99ee99' : baseColor;
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
      const shouldBeVisible = userWantsLayerVisible && currentZoom >= 17;

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
        return;
      }

      currentStreetId = newStreetId;

      if (streetNameSpan && currentStreetDiv && streetNames[currentStreetId]) {
        streetNameSpan.textContent = streetNames[currentStreetId];
        currentStreetDiv.style.display = 'block';
      }

      applyFeatureFilter();
    }

    function handleMapClick(evt) {
      if (!lastFeatures.length) return;
      
      // Support both coordinate formats
      const x = evt.x ?? evt.clientX ?? evt.layerX;
      const y = evt.y ?? evt.clientY ?? evt.layerY;
      if (x == null || y == null) return;

      const MAX_PIXELS_SQ = MAX_CLICK_DISTANCE_PX * MAX_CLICK_DISTANCE_PX;
      let bestFeature = null;
      let bestDistSq = Infinity;

      for (const f of lastFeatures) {
        if (f.lon == null || f.lat == null || isNaN(f.lon) || isNaN(f.lat)) continue;
        const fPx = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: f.lon, lat: f.lat } });
        if (!fPx) continue;
        const dx = fPx.x - x;
        const dy = fPx.y - y;
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

    // Tooltip for hover info
    const mapContainer = document.querySelector('#map-container, #WazeMap, .ol-viewport, .map-container, canvas') || document.body;
    const tooltipEl = document.createElement('div');
    tooltipEl.id = 'qhnua-tooltip';
    tooltipEl.style.cssText = 'position:fixed;top:0;left:0;transform:translate(0,0);z-index:10000;background:rgba(0,0,0,0.85);color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;white-space:nowrap;display:none;';
    document.body.appendChild(tooltipEl);

    let hoverHideTimer = null;
    function handleMouseMove(evt) {
      if (!lastFeatures.length) { tooltipEl.style.display = 'none'; return; }
      const x = evt.x;
      const y = evt.y;
      const cx = evt.clientX;
      const cy = evt.clientY;
      if (x == null || y == null) return;

      let found = null;
      let foundPx = null;
      for (const f of lastFeatures) {
        if (f.lon == null || f.lat == null) continue;
        const fPx = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: f.lon, lat: f.lat } });
        if (!fPx) continue;
        const d = Math.hypot(fPx.x - x, fPx.y - y);
        if (d <= 30 && d < 200) { found = f; foundPx = fPx; break; }
      }

      if (found) {
        const city = found.settlement || '';
        const street = found.streetRaw || '';
        const num = found.houseNumberRaw || found.number || '';
        const source = found.source || '';
        const sourceLabels = { 'waze': 'Waze', 'visicom': 'Visicom', 'osm': 'OSM' };
        const sourceText = sourceLabels[source] || source;
        tooltipEl.innerHTML = `${city ? city + '<br>' : ''}<b>${sourceText}</b>: ${street || '—'}${num ? ', ' + num : ''}`;
        // Position tooltip at marker (transform uses screen coordinates for position:fixed)
        const vpRect = mapContainer.getBoundingClientRect();
        const sx = vpRect.left + foundPx.x + 15;
        const sy = vpRect.top + foundPx.y - 45;
        tooltipEl.style.transform = `translate(${sx}px, ${sy}px)`;
        tooltipEl.style.display = 'block';
      } else {
        tooltipEl.style.display = 'none';
      }
    }

    wmeSDK.Events.on({ eventName: 'wme-map-mouse-move', eventHandler: handleMouseMove });

    function onFeatureClick(feature) {
      if (feature.processed) return;
      if (typeof feature.lat !== 'number' || typeof feature.lon !== 'number' || isNaN(feature.lat) || isNaN(feature.lon)) {
        console.warn('[UA-RPP] Invalid coordinates for feature:', feature);
        return;
      }

      const houseNumber = normalizeHouseNumber(feature.number);
      const featureLon = feature.lon;
      const featureLat = feature.lat;

      try {
        // Find the nearest segment to get the street
        const segments = wmeSDK.DataModel.Segments.getAll();
        
        let nearestStreetId = null;
        let minDist = Infinity;
        
        // Calculate distance to segment
        function pointToSegmentDist(px, py, x1, y1, x2, y2) {
          const dx = x2 - x1;
          const dy = y2 - y1;
          if (dx === 0 && dy === 0) {
            return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
          }
          const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
          const closestX = x1 + t * dx;
          const closestY = y1 + t * dy;
          return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
        }
        
// Convert feature coords to pixel coords
        const featurePx = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: featureLon, lat: featureLat } });

        for (const seg of segments) {
          const coords = seg.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) continue;
          
          // Calculate distance to each segment line
          for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            if (!p1 || !p2) continue;
            
            const p1Px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: p1[0], lat: p1[1] } });
            const p2Px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: p2[0], lat: p2[1] } });
            
            const dist = pointToSegmentDist(featurePx.x, featurePx.y, p1Px.x, p1Px.y, p2Px.x, p2Px.y);
            if (dist < minDist) { // увеличен порог до 300px
              minDist = dist;
              nearestStreetId = seg.primaryStreetId;
            }
          }
        }
        
        if (!nearestStreetId) {
          console.warn('[UA-RPP] Не знайдено сегментів. Мінімальна відстань:', minDist, 'px');
          throw new Error('Не знайдено сегментів поруч з цим маркером');
        }
        
        // Check if street has a name (RPP cannot be created without street name)
        const street = wmeSDK.DataModel.Streets.getById({ streetId: nearestStreetId });
        if (!street || !street.name) {
          throw new Error('Сегмент без назви вулиці — RPP не можна створити');
        }
        
        const streetId = nearestStreetId;

        // Check for duplicates before creating
        if (LS.getNoDuplicates() && hasDuplicate(houseNumber, streetId, true)) {
          throw new Error('RPP з таким номером вже існує на цій вулиці');
        }

        const geometry = {
          type: 'Point',
          coordinates: [feature.lon, feature.lat]
        };

        // Add venue
        const venueId = wmeSDK.DataModel.Venues.addVenue({
          category: 'OTHER',
          geometry: geometry
        });

        // Update with address and street
        wmeSDK.DataModel.Venues.updateVenue({
          venueId: String(venueId),
          name: houseNumber
        });
        
        wmeSDK.DataModel.Venues.updateAddress({
          venueId: String(venueId),
          houseNumber: houseNumber,
          streetId: streetId
        });

        // Set as residential
        wmeSDK.DataModel.Venues.updateVenueIsResidential({
          venueId: String(venueId),
          isResidential: true
        });

        // Add entry point for navigation
        wmeSDK.DataModel.Venues.replaceNavigationPoints({
          venueId: String(venueId),
          navigationPoints: [{
            isEntry: true,
            isExit: true,
            isPrimary: true,
            name: '',
            point: { type: 'Point', coordinates: [feature.lon, feature.lat] }
          }]
        });

        // Lock to level 2 if enabled and user has rank > 0
        if (LS.getLockRank2() && wmeSDK.State?.getUserInfo) {
          try {
            const userInfo = wmeSDK.State.getUserInfo();
            if (userInfo?.rank > 0) {
              const venue = wmeSDK.DataModel.Venues.getById({ venueId: String(venueId) });
              if (venue && venue.lockRank < 1) {
                wmeSDK.DataModel.Venues.updateVenue({
                  venueId: String(venueId),
                  lockRank: 1
                });
                console.log('[UA-RPP] Locked venue to level 2:', venueId);
              }
            }
          } catch (e) {
            console.warn('[UA-RPP] Could not lock venue:', e);
          }
        }

        // Select the new venue to open edit panel
        wmeSDK.Editing.setSelection({
          selection: {
            ids: [String(venueId)],
            objectType: 'venue'
          }
        });

        feature.userAdded = true;
        feature.processed = true;
        feature.conflict = false;
        applyFeatureFilter();

        toast(`Додано RPP ${houseNumber} 🏠`, 'success');
      } catch (err) {
        console.error('[UA-RPP] Помилка додавання RPP:', err);
        toast(err.message || 'Помилка додавання RPP', 'error');
        lastRestriction = { number: houseNumber, reason: err.message };
        if (restrictionsDiv) {
          restrictionsDiv.innerHTML = `<i class="fa fa-exclamation-triangle"></i> <b>Помилка:</b> ${houseNumber} — ${err.message}`;
        }
      }
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
      tabLabel.innerText = 'UA-RPP';
      tabLabel.title = 'Швидкий імпорт номерів (Україна)';

      tabPane.innerHTML = `
        <div id="qhnua-pane" style="padding:10px;">
          <h2 style="margin-top:0;">Швидкий імпорт <span style="color:#8A2BE2;font-weight:bold;margin-left:4px;">▲</span></h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px 0;">
            <button id="hn-load" class="wz-button"><span id="hn-load-label">Завантажити</span> <kbd style="margin-left:6px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(0,0,0,0.08);border-radius:3px;padding:2px 5px;color:#555;">Alt+Shift+L</kbd></button>
            <button id="hn-clear" class="wz-button wz-button--secondary">Очистити <kbd style="margin-left:6px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(0,0,0,0.08);border-radius:3px;padding:2px 5px;color:#555;">Alt+Shift+K</kbd></button>
          </div>
          <div id="hn-current-street" style="margin:8px 0;padding:8px;background:#f0f0f0;border-radius:4px;font-size:13px;display:none;">
            <b>Вибрана вулиця WME:</b> <span id="hn-street-name" style="color:#2a7;font-weight:bold;">—</span>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <wz-checkbox id="hn-toggle">Показати точки</wz-checkbox>
            <wz-checkbox id="hn-no-duplicates">Не створювати дублікати</wz-checkbox>
            <wz-checkbox id="hn-lock-rank2">Заблокувати RPP (рівень 2)</wz-checkbox>
            <span style="font-size:12px;">Радіус (м): <input id="qhnua-buffer" type="number" min="0" step="50" style="width:80px;margin-left:6px"></span>
          </div>
          <div style="margin:6px 0;font-size:13px;">
            <span style="color:#0066cc;font-weight:bold;">Джерела:</span><br/>
            <label style="margin-right:12px;"><input type="checkbox" id="qhnua-src-waze" checked> Waze (зелений)</label>
            <label style="margin-right:12px;"><input type="checkbox" id="qhnua-src-visicom"> Visicom (жовтий)</label>
            <label><input type="checkbox" id="qhnua-src-osm"> OSM (оранжевий)</label>
          </div>
          <div style="margin:6px 0;font-size:12px;">
            <label style="display:block;margin-bottom:4px;">API ключ Visicom (<a href="https://api.visicom.ua/accounts/forms?page=register" target="_blank" style="color:#0066cc;text-decoration:none;">Отримати тут</a>):</label>
            <input id="qhnua-visicom-key" type="text" placeholder="Вставте ключ API" style="width:100%;padding:4px;font-size:12px;border:1px solid #ccc;border-radius:3px;">
          </div>
          <div id="hn-status" style="margin-top:10px;font-size:12px;color:#666;line-height:1.4;">
            <b>Інструкція</b><br/>
            1) Відкрийте потрібну область на карті • 2) Натиснути "Завантажити" • 3) <b>Клікнути номер на карті для додавання</b>
          </div>
          <div id="hn-restrictions" style="margin-top:8px;font-size:11px;color:#c00;line-height:1.3;"></div>
          <div style="margin-top:12px;padding-top:6px;border-top:1px solid #eee;width:100%;box-sizing:border-box;">
            <div style="background:#005bbb;color:#fff;padding:8px;font-size:25px;text-align:center;width:100%;box-sizing:border-box;">made in</div>
            <div style="background:#ffd500;color:#000;padding:8px;font-size:25px;text-align:center;width:100%;box-sizing:border-box;">Ukraine</div>
          </div>
        </div>
      `;

      const btnLoad      = tabPane.querySelector('#hn-load');
      const btnLoadLabel = tabPane.querySelector('#hn-load-label');
      const btnClear     = tabPane.querySelector('#hn-clear');
      const chkVis = tabPane.querySelector('#hn-toggle');
      const bufferEl   = tabPane.querySelector('#qhnua-buffer');
      const statusDiv  = tabPane.querySelector('#hn-status');
      const restrictionsDiv = tabPane.querySelector('#hn-restrictions');

      currentStreetDiv = tabPane.querySelector('#hn-current-street');
      streetNameSpan = tabPane.querySelector('#hn-street-name');

      const isChecked  = (el) => el?.hasAttribute('checked');
      const setChecked = (el, v) => { if (el) v ? el.setAttribute('checked', '') : el.removeAttribute('checked'); };
      const safeSetChecked = (id, v) => { const el = tabPane.querySelector(id); if (el) v ? el.setAttribute('checked', '') : el.removeAttribute('checked'); };

      bufferEl.value = String(LS.getBuffer());
      if (LS.getLayerVisible()) {
        setChecked(chkVis, true);
        userWantsLayerVisible = true;
        updateLayerVisibility();
      }
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

      const chkNoDups = tabPane.querySelector('#hn-no-duplicates');
      if (chkNoDups) {
        setChecked(chkNoDups, LS.getNoDuplicates());
        chkNoDups.addEventListener('click', () => {
          const on = isChecked(chkNoDups);
          setChecked(chkNoDups, !on);
          LS.setNoDuplicates(!on);
        });
      }

      const chkLockRank2 = tabPane.querySelector('#hn-lock-rank2');
      if (chkLockRank2) {
        setChecked(chkLockRank2, LS.getLockRank2());
        chkLockRank2.addEventListener('click', () => {
          const on = isChecked(chkLockRank2);
          setChecked(chkLockRank2, !on);
          LS.setLockRank2(!on);
        });
      }

      const visicomKeyEl = tabPane.querySelector('#qhnua-visicom-key');
      if (visicomKeyEl) {
        visicomKeyEl.value = LS.getVisicomKey();
        visicomKeyEl.addEventListener('change', () => {
          LS.setVisicomKey(visicomKeyEl.value.trim());
        });
      }

      const sourceEl = tabPane.querySelector('#qhnua-source');
      if (sourceEl) {
        sourceEl.value = LS.getSource();
        sourceEl.addEventListener('change', () => {
          LS.setSource(sourceEl.value);
        });
      }

      // Restore source checkboxes from localStorage
      const chkWaze = tabPane.querySelector('#qhnua-src-waze');
      const chkVisicom = tabPane.querySelector('#qhnua-src-visicom');
      const chkOsm = tabPane.querySelector('#qhnua-src-osm');
      const savedSources = LS.getSources();
      if (chkWaze) { chkWaze.checked = savedSources.includes('waze'); }
      if (chkVisicom) { chkVisicom.checked = savedSources.includes('visicom'); }
      if (chkOsm) { chkOsm.checked = savedSources.includes('osm'); }
      const updateSourcesStorage = () => {
        const sources = [];
        if (chkWaze?.checked) sources.push('waze');
        if (chkVisicom?.checked) sources.push('visicom');
        if (chkOsm?.checked) sources.push('osm');
        LS.setSources(sources);
      };
      chkWaze?.addEventListener('change', updateSourcesStorage);
      chkVisicom?.addEventListener('change', updateSourcesStorage);
      chkOsm?.addEventListener('change', updateSourcesStorage);

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

        await updateLayer(statusDiv, myLoadId).catch(err => console.warn('UA-RPP updateLayer:', err));

        // Skip post-load side effects if user clicked Clear (or started another Load) mid-fetch
        if (myLoadId === currentLoadId) {
          userWantsLayerVisible = true;
          setChecked(chkVis, true);
          LS.setLayerVisible(true);
          updateLayerVisibility();
        }

        btnLoad.disabled = false;
        btnLoadLabel.textContent = 'Завантажити';
        isLoading = false;
      }

      btnLoad.addEventListener('click', loadSelectedStreet);

      function clearLayer() {
        currentLoadId++; // invalidate any in-flight load so its results are discarded
        if (lastSdkFeatureIds.length) {
          wmeSDK.Map.removeFeaturesFromLayer({ layerName: SDK_LAYER_NAME, featureIds: lastSdkFeatureIds });
          lastSdkFeatureIds = [];
        }
        // Clear deduplication cache so reloading shows all addresses
        window.__uaRppSeenFeatures?.clear();
        lastRestriction = null;
        userWantsLayerVisible = false;
        wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: false });
        setChecked(chkVis, false);
        LS.setLayerVisible(false);
        streets = {};
        streetNames = {};
        currentStreetId = null;
        lastFeatures = [];
        currentStreetDiv.style.display = 'none';
        restrictionsDiv.innerHTML = '';
        statusDiv.innerHTML = `<b>Інструкція</b><br/>
          1) Вибрати сегмент • 2) Натиснути "Завантажити" • 3) <b>Клікнути номер на карті для додавання</b>`;
      }

      btnClear.addEventListener('click', clearLayer);

      applyFeatureFilter = function () {
        const visible = lastFeatures.filter(feat => {
          if (typeof feat.lat !== 'number' || typeof feat.lon !== 'number' || isNaN(feat.lat) || isNaN(feat.lon)) return false;
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
            streetRaw: feat.streetRaw || '',
            houseNumberRaw: feat.houseNumberRaw || '',
            city: feat.settlement || '',
            processed: feat.processed,
            conflict: feat.conflict,
            isSelectedStreet: feat.street === currentStreetId,
            source: feat.source || LS.getSource()
          }
        }));
        wmeSDK.Map.addFeaturesToLayer({ layerName: SDK_LAYER_NAME, features: visibleSdk });
        lastSdkFeatureIds = visibleSdk.map(f => f.id);
      };

      // Register keyboard shortcuts
      ['qhnua-load', 'qhnua-clear'].forEach(id => {
        try { wmeSDK.Shortcuts.deleteShortcut({ shortcutId: id }); } catch (_) {}
      });
      [
        { shortcutId: 'qhnua-load',  shortcutKeys: 'AS+l', description: 'UA-RPP: Завантажити', callback: loadSelectedStreet },
        { shortcutId: 'qhnua-clear', shortcutKeys: 'AS+k', description: 'UA-RPP: Очистити',                callback: clearLayer }
      ].forEach(spec => {
        try { wmeSDK.Shortcuts.createShortcut(spec); }
        catch (e) { console.warn('UA-RPP: не вдалося зареєструвати хоткей', spec.shortcutId, e); }
      });

      function updateLayer(statusDiv, loadId) {
        return new Promise((resolve) => {
          loading.style.display = null;

          // Get visible map bounds instead of segment selection
          const ext = wmeSDK.Map.getMapExtent();
          // WME SDK format can be: [lonMin, latMin, lonMax, latMax] array or { lonMin, latMin, lonMax, latMax }
          let lonMin, latMin, lonMax, latMax;
          if (Array.isArray(ext)) {
            [lonMin, latMin, lonMax, latMax] = ext;
          } else if (ext) {
            // Try multiple property name variations
            lonMin = ext.lonMin ?? ext._southWest?.lng ?? ext.southWest?.lng;
            latMin = ext.latMin ?? ext._southWest?.lat ?? ext.southWest?.lat;
            lonMax = ext.lonMax ?? ext._northEast?.lng ?? ext.northEast?.lng;
            latMax = ext.latMax ?? ext._northEast?.lat ?? ext.northEast?.lat;
          }

          if (lonMin === undefined || latMin === undefined) {
            loading.style.display = 'none';
            statusDiv.textContent = 'Не вдалося отримати межі карти.';
            resolve();
            return;
          }

          const centerLat = (latMin + latMax) / 2;
          const centerLon = (lonMin + lonMax) / 2;
          const zoom = wmeSDK.Map.getZoomLevel();

          // Radius based on visible extent + user buffer
          const latRadius = (latMax - latMin) / 2 * 111000;
          const lonRadius = (lonMax - lonMin) / 2 * 111000;
          let radius = Math.max(latRadius, lonRadius) * 0.6; // 60% of half-diagonal
          const userBuffer = LS.getBuffer();
          radius = Math.max(radius, userBuffer);

          // Choose data sources (multi-select via checkboxes)
          const sources = [];
          if (document.getElementById('qhnua-src-waze')?.checked) sources.push('waze');
          if (document.getElementById('qhnua-src-visicom')?.checked) sources.push('visicom');
          if (document.getElementById('qhnua-src-osm')?.checked) sources.push('osm');
          if (sources.length === 0) sources.push('waze'); // fallback
          
          const bounds = { minLon: lonMin, minLat: latMin, maxLon: lonMax, maxLat: latMax };
          
          // Fetch all selected sources in parallel
          const fetchPromises = sources.map(src => {
            if (src === 'visicom') return fetchAddressesVisicom(bounds);
            if (src === 'osm') return fetchAddressesOSM(centerLat, centerLon, radius);
            return fetchAddressesWaze(centerLat, centerLon, radius);
          });
          
          Promise.all(fetchPromises)
            .then(results => {
              // Bail out if user clicked Clear
              if (loadId !== currentLoadId) {
                loading.style.display = 'none';
                resolve();
                return;
              }
              
              // Merge results from all sources
              let allFeatures = [];
              let allStreets = {};
              let allStreetNames = {};
              
              for (let i = 0; i < results.length; i++) {
                const apiResult = results[i];
                allFeatures = allFeatures.concat(apiResult.features || []);
                Object.assign(allStreets, apiResult.streets || {});
                Object.assign(allStreetNames, apiResult.streetNames || {});
              }
              
              streets = allStreets;
              streetNames = allStreetNames;

              // Persistent deduplication Set (survives between updateLayer calls)
              // Key: normalized number + rounded coordinates (to filter duplicates at same location)
              if (!window.__uaRppSeenFeatures) window.__uaRppSeenFeatures = new Set();
              const seenFeatures = window.__uaRppSeenFeatures;

              const features = [];
              for (const item of allFeatures) {
                if (!item.lat || !item.lon) continue;

// TODO: Filter by city using coordinates (nearest city lookup via kadastrova-karta API)

                const normalizedNum = normalizeHouseNumber(item.number);
                const processed = false;

                // Also check for conflicts (different number nearby)
                const conflict = hasConflict(normalizedNum, item.lon, item.lat, null);

                // Create unique key: number + street only (same address cannot appear twice on one street)
                // Deduplication persists across reloads until Clear is clicked
                const featureKey = `${normalizedNum}|${item.street}`;
                if (seenFeatures.has(featureKey)) continue;
                seenFeatures.add(featureKey);

                features.push({
                  number: normalizedNum,
                  street: item.street,
                  streetRaw: item.streetRaw || '',
                  houseNumberRaw: item.houseNumberRaw || normalizedNum,
                  processed,
                  conflict,
                  lon: item.lon,
                  lat: item.lat,
                  source: item.source || LS.getSource()
                });
              }

              currentStreetId = null;

              if (!features.length) {
                loading.style.display = 'none';
                statusDiv.textContent = 'Не знайдено адрес у цьому районі.';
                resolve();
                return;
              }

              statusDiv.textContent = `Знайдено: ${features.length} адрес (радіус: ${Math.round(radius)}м)`;
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

              // Ensure layer is visible after load
              lastComputedVisibility = true; // Force visibility state
              wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: true });
              userWantsLayerVisible = true;
              setChecked(chkVis, true);
              LS.setLayerVisible(true);

loading.style.display = 'none';
              statusDiv.innerHTML = `Завантажено ${features.length} адрес.<br/>` +
                `<b>Клікніть на номер на карті, щоб додати!</b>`;
              resolve();
            })
            .catch(err => {
              console.error('[UA-RPP] Помилка API:', err);
              loading.style.display = 'none';
              if (loadId === currentLoadId) {
                statusDiv.textContent = 'Помилка отримання даних. Перевірте консоль.';
                toast('Помилка отримання даних адрес.', 'error');
              }
              resolve();
            });
        });
      }

      });
  }

  (unsafeWindow || window).SDK_INITIALIZED.then(() => {
    wmeSDK = getWmeSdk({ scriptId: 'quick-rpp-ua-importer', scriptName: 'Quick RPP Importer (UA)' });
    wmeSDK.Events.once({ eventName: 'wme-ready' }).then(() => {
      const required = [
        'Map.addLayer',
        'Map.addFeaturesToLayer',
        'Map.removeFeaturesFromLayer',
        'Map.setLayerVisibility',
        'Map.getZoomLevel',
        'Map.getMapExtent',
        'Map.getMapPixelFromLonLat',
        'DataModel.Venues.addVenue',
        'DataModel.Venues.updateVenue',
        'DataModel.Venues.updateAddress',
        'DataModel.Venues.updateVenueIsResidential',
        'DataModel.Venues.replaceNavigationPoints',
        'DataModel.Venues.getAddress',
        'DataModel.Venues.getAll',
        'DataModel.Streets.getStreet',
        'DataModel.Streets.getById',
        'Editing.setSelection'
      ];
      const missing = required.filter(path => {
        const parts = path.split('.');
        let cur = wmeSDK;
        for (const part of parts) { cur = cur?.[part]; if (cur == null) return true; }
        return false;
      });
      if (missing.length) {
        console.error('[UA-RPP] WME SDK відсутні необхідні API:', missing);
        toast(`UA-RPP: WME SDK не має ${missing.length} необхідних API. Див. консоль.`, 'error');
        return;
      }
      init();
    });
  });
})();