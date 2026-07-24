// ==UserScript==
// @name         WME UA-RPP
// @namespace    https://github.com/EdjOne/house-number
// @version     1.11.1
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
// @connect      api.openstreetmap.org
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_info
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
  const OVERPASS_APIS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
    'https://overpass.openstreetmap.org/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm2/api/interpreter',
    'https://proxy.http.net/?https://overpass-api.de/api/interpreter',
    'https://r.jina.ai/http://overpass-api.de/api/interpreter'
  ];
  const OVERPASS_TIMEOUT = 120000;



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
    getSources()      { try { return JSON.parse(localStorage.getItem('qhnua-sources') || '[]'); } catch { return []; } },
    setSources(v)     { localStorage.setItem('qhnua-sources', JSON.stringify(v)); },
    getSnapToRoad()   { return localStorage.getItem('qhnua-snap-road') === '1'; },
    setSnapToRoad(v)  { localStorage.setItem('qhnua-snap-road', v ? '1' : '0'); },
    getSnapDistance() { return Number(localStorage.getItem('qhnua-snap-dist') ?? '20'); },
    setSnapDistance(v){ localStorage.setItem('qhnua-snap-dist', String(v)); },
    getCreatePOI()    { return localStorage.getItem('qhnua-create-poi') === '1'; },
    setCreatePOI(v)   { localStorage.setItem('qhnua-create-poi', v ? '1' : '0'); }
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
 
  // Calculate distance between two lat/lon points (Haversine formula) in kilometers
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Calculate minimum distance (km) from point to any point along a segment polyline
  function minDistanceToSegment(lat, lon, seg) {
    const coords = seg.geometry?.coordinates;
    if (!coords || coords.length < 2) return Infinity;
    let minKm = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i], p2 = coords[i + 1];
      if (!p1 || !p2) continue;
      const proj = projectOnSegment(lon, lat, p1[0], p1[1], p2[0], p2[1]);
      if (proj.dist < minKm) minKm = proj.dist;
    }
    return minKm / 1000; // meters → km
  }

  function normalizeStreetName(name) {
    return String(name).toLowerCase().replace(/\s+/g, '_');
  }

  // Projection of point onto line segment with cosine correction for lat/lon
  // Returns projected lon, lat, distance in meters, and t (0..1 on segment)
  function projectOnSegment(px, py, x1, y1, x2, y2) {
    // Average latitude for cosine correction
    const avgLat = (y1 + y2 + py) / 3;
    const cosLat = Math.cos(avgLat * Math.PI / 180);

    // Work in approximate meter-space (x = lon * cos(lat), y = lat)
    const cx = px * cosLat, cy = py;
    const cx1 = x1 * cosLat, cy1 = y1;
    const cx2 = x2 * cosLat, cy2 = y2;

    const dx = cx2 - cx1, dy = cy2 - cy1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
      const mDx = (px - x1) * cosLat * 111320, mDy = (py - y1) * 111320;
      return { lon: x1, lat: y1, dist: Math.hypot(mDx, mDy), t: 0 };
    }

    let t = ((cx - cx1) * dx + (cy - cy1) * dy) / len2;
    const rawT = t; // before clamping — tells us if projection is a true perpendicular
    t = Math.max(0, Math.min(1, t));

    // Convert back to lon/lat
    const projLon = x1 + t * (x2 - x1);
    const projLat = y1 + t * (y2 - y1);

    // Distance in meters
    const meterDx = (px - projLon) * cosLat * 111320;
    const meterDy = (py - projLat) * 111320;
    const dist = Math.hypot(meterDx, meterDy);

    return { lon: projLon, lat: projLat, dist, t: rawT };
  }

  // Convert meters to degrees (approx)
  function metersToDeg(m) { return m / 111320; }

  // Snap marker toward nearest road segment, offset along perpendicular
  // Fuzzy street name match: handles typos, doubled/missing letters
  // 1) Common prefix ≥5 chars, OR 2) Levenshtein distance ≤2
  function fuzzyStreetMatch(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    // Quick check: common prefix ≥5
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    if (prefix >= 5) return true;
    // Substring check: one contains the other (e.g. "українки" in "лесі українки")
    // catches initials like "л. українки" → "українки" matching "лесі українки"
    if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
    // Levenshtein distance ≤2 (handles typos, doubled/missing letters like "бесарабська" vs "бессарабська")
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return false; // too different in length
    const dp = [];
    for (let i = 0; i <= m; i++) dp[i] = [i];
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i-1][j] + 1,
          dp[i][j-1] + 1,
          dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
        );
      }
      if (dp[i][n] <= 2) return true; // early exit
    }
    return dp[m][n] <= 2;
  }

  // Find WME numeric street ID by street name (with fuzzy matching)
  // If match via alternate street — returns the PRIMARY street ID
  function findWmeStreetId(streetName) {
    const allStreets = wmeSDK.DataModel.Streets.getAll();
    const target = normalizeForComparison(cleanStreetName(streetName));
    // First pass: exact/fuzzy match on primary name
    for (const s of allStreets) {
      if (fuzzyStreetMatch(normalizeForComparison(cleanStreetName(s.name || '')), target)) {
        return s.id;
      }
    }
    // Second pass: match via alternate street → return primary street ID
    const allSegments = wmeSDK.DataModel.Segments.getAll();
    for (const seg of allSegments) {
      if (!seg.alternateStreetIds?.length) continue;
      for (const altId of seg.alternateStreetIds) {
        const altStreet = wmeSDK.DataModel.Streets.getById({ streetId: altId });
        if (fuzzyStreetMatch(normalizeForComparison(cleanStreetName(altStreet?.name || '')), target)) {
          // Return the PRIMARY street of this segment, not the alternate
          const primaryStreet = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
          if (primaryStreet) return primaryStreet.id;
        }
      }
    }
    return null;
  }

  function snapToNearestRoad(lon, lat, preferredStreetId) {
    try {
      const allSegments = wmeSDK.DataModel.Segments.getAll();
      let bestPerpDist = Infinity, bestPerpProj = null;
      let bestEndDist = Infinity, bestEndProj = null;

      for (const seg of allSegments) {
        // If a preferred street is specified, only snap to segments on that street
        if (preferredStreetId && seg.primaryStreetId !== preferredStreetId) continue;

        const coords = seg.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;

        for (let i = 0; i < coords.length - 1; i++) {
          const proj = projectOnSegment(lon, lat, coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
          const isPerpendicular = proj.t > 0.01 && proj.t < 0.99;
          if (isPerpendicular && proj.dist < bestPerpDist) {
            bestPerpDist = proj.dist;
            bestPerpProj = proj;
          } else if (!isPerpendicular && proj.dist < bestEndDist) {
            bestEndDist = proj.dist;
            bestEndProj = proj;
          }
        }
      }

      // Prefer true perpendicular; fall back to endpoint if none found
      const bestProj = bestPerpProj || bestEndProj;
      const bestDist = bestPerpProj ? bestPerpDist : bestEndDist;

      const maxDist = 100; // meters
      const offsetMeters = LS.getSnapDistance();
      if (bestProj && bestDist < maxDist) {
        const avgLat = (lat + bestProj.lat) / 2;
        const cosLat = Math.cos(avgLat * Math.PI / 180);

        const meterDx = (lon - bestProj.lon) * cosLat * 111320;
        const meterDy = (lat - bestProj.lat) * 111320;
        const distMeters = Math.hypot(meterDx, meterDy);

        if (distMeters < 0.01) return null;

        const unitX = meterDx / distMeters;
        const unitY = meterDy / distMeters;

        const offsetLon = bestProj.lon + (unitX * offsetMeters) / (cosLat * 111320);
        const offsetLat = bestProj.lat + (unitY * offsetMeters) / 111320;

        return { lon: offsetLon, lat: offsetLat };
      }
    } catch (e) {
      console.warn('[UA-RPP] snapToRoad error:', e.message);
    }
    return null;
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
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // Remove street-name initials: up to 3 Cyrillic/Latin letters + dot (with optional space)
    // e.g. "л. українки" → "українки", "ів. франка" → "франка" (matches "івана франка")
    // Also handles: Т. Шевченка, М. Грушевського, Ів. Франка, І.Франка, etc.
    normalized = normalized.replace(/^[а-яіїєґa-z]{1,3}\s*\.\s*/, '');
    normalized = normalized.replace(/\s[а-яіїєґa-z]{1,3}\s*\.\s*/g, ' ');

    return normalized.trim();
  }

  function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Clean street name for Visicom: remove old name in parentheses
  // "вулиця Нова (Стара вулиця)" → "вулиця Нова"
  function cleanStreetName(name) {
    if (!name) return name;
    return String(name).split('(')[0].trim();
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
            console.warn('[UA-RPP] Waze API parse error:', err);
            resolve({ features: [], streets: {}, streetNames: {} });
          }
        },
        onerror: function (err) {
          console.warn('[UA-RPP] Waze API network error:', err);
          resolve({ features: [], streets: {}, streetNames: {} });
        },
        ontimeout: function () {
          console.warn('[UA-RPP] Waze API timeout');
          resolve({ features: [], streets: {}, streetNames: {} });
        }
      });
    });
  }

  // Fetch addresses from Visicom API
  function fetchAddressesVisicom(bounds) {
    return new Promise((resolve, reject) => {
      const apiKey = LS.getVisicomKey();
      if (!apiKey) {
        toast('⚠️ Visicom: API ключ не встановлено.', 'warning');
        resolve({ features: [], streets: {}, streetNames: {} });
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
            if (response.status === 403) {
              toast('⚠️ Visicom API: ключ недійсний або закінчився (403). Оновіть ключ або використовуйте інше джерело.', 'error');
            } else {
              toast(`⚠️ Visicom API: помилка ${response.status}. Спробуйте інше джерело.`, 'error');
            }
            // Resolve with empty result instead of rejecting — don't crash the whole load
            resolve({ features: [], streets: {}, streetNames: {} });
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
            resolve({ features: [], streets: {}, streetNames: {} });
          }
        },
        onerror: function(err) {
          console.error('[Visicom] Network error:', err);
          toast('⚠️ Visicom API: помилка мережі. Перевірте з\'єднання.', 'error');
          resolve({ features: [], streets: {}, streetNames: {} });
        },
        ontimeout: function() {
          toast('⚠️ Visicom API: таймаут запиту.', 'error');
          resolve({ features: [], streets: {}, streetNames: {} });
        }
      });
    });
  }

// Fetch addresses from OSM API (api.openstreetmap.org - works without CORS issues)
  function fetchAddressesOSM(centerLat, centerLon, radius) {
    return new Promise((resolve, reject) => {
      // Convert radius (meters) to degrees (approx: 1° = 111km)
      const deg = (Math.round(radius) / 111000) * 1.15; // slightly larger radius for better coverage
      const bbox = `${centerLon - deg},${centerLat - deg},${centerLon + deg},${centerLat + deg}`;
      const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`;

      console.log(`[OSM] Fetching ${url}`);

      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 60000,
        headers: {
          'Accept': 'application/json'
        },
        onload: function (response) {
          try {
            const respText = response.responseText || '';

            // Check for HTML error
            if (respText.trim().startsWith('<')) {
              console.warn('[OSM] Server returned HTML error, trying XML parse...');
              // Try parsing XML - OSM API returns XML by default
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(respText, 'text/xml');
              const ns = xmlDoc.documentElement;
              if (ns && ns.tagName === 'osm') {
                parseOSMXML(ns, resolve);
                return;
              }
              reject(new Error('OSM server error'));
              return;
            }

            // Try JSON first
            try {
              const data = JSON.parse(respText);
              processOSMElements(data.elements || [], resolve);
            } catch (e) {
              // Try XML
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(respText, 'text/xml');
              const ns = xmlDoc.documentElement;
              if (ns && ns.tagName === 'osm') {
                parseOSMXML(ns, resolve);
              } else {
                reject(new Error('Unknown OSM response format'));
              }
            }
          } catch (err) {
            reject(err);
          }
        },
        onerror: function (err) {
          reject(new Error('OSM network error: ' + err));
        },
        ontimeout: function () {
          reject(new Error('OSM timeout'));
        }
      });
    });
  }

  // Parse OSM XML format
  function parseOSMXML(xmlDoc, resolve) {
    const features = [];
    const streetNames = {};
    const streets = {};

    // Parse nodes
    const nodes = xmlDoc.querySelectorAll('node');
    const nodeMap = {};

    nodes.forEach(node => {
      const lat = parseFloat(node.getAttribute('lat'));
      const lon = parseFloat(node.getAttribute('lon'));
      const id = node.getAttribute('id');
      const tags = {};
      node.querySelectorAll('tag').forEach(tag => {
        tags[tag.getAttribute('k')] = tag.getAttribute('v');
      });

      const houseNumber = tags['addr:housenumber'];
      const street = tags['addr:street'] || tags['addr:full'];

      if (houseNumber && street) {
        const streetId = normalizeStreetName(street);
        if (!streets[street]) {
          streets[street] = streetId;
          streetNames[streetId] = street;
        }
        features.push({
          number: String(houseNumber).toLowerCase(),
          street: streetId,
          streetRaw: street,
          houseNumberRaw: String(houseNumber),
          lat: lat,
          lon: lon,
          source: 'osm'
        });
      }

      if (node.querySelectorAll('tag').length > 0) {
        // ways reference nodes by ID, store lat/lon for later
      }
      nodeMap[id] = { lat, lon };
    });

    // Parse ways + center (ways only for addr data)
    const ways = xmlDoc.querySelectorAll('way');
    ways.forEach(way => {
      const tags = {};
      way.querySelectorAll('tag').forEach(tag => {
        tags[tag.getAttribute('k')] = tag.getAttribute('v');
      });

      const houseNumber = tags['addr:housenumber'];
      const street = tags['addr:street'] || tags['addr:full'];

      if (houseNumber && street) {
        // Calculate center from nd references
        const ndRefs = way.querySelectorAll('nd');
        let sumLat = 0, sumLon = 0, count = 0;
        ndRefs.forEach(nd => {
          const ref = nd.getAttribute('ref');
          if (nodeMap[ref]) {
            sumLat += nodeMap[ref].lat;
            sumLon += nodeMap[ref].lon;
            count++;
          }
        });

        const lat = count > 0 ? sumLat / count : null;
        const lon = count > 0 ? sumLon / count : null;

        if (lat != null && lon != null) {
          const streetId = normalizeStreetName(street);
          if (!streets[street]) {
            streets[street] = streetId;
            streetNames[streetId] = street;
          }
          features.push({
            number: String(houseNumber).toLowerCase(),
            street: streetId,
            streetRaw: street,
            houseNumberRaw: String(houseNumber),
            lat: lat,
            lon: lon,
            source: 'osm'
          });
        }
      }
    });

    // Parse relations for addr tags
    const relations = xmlDoc.querySelectorAll('relation');
    relations.forEach(rel => {
      const tags = {};
      rel.querySelectorAll('tag').forEach(tag => {
        tags[tag.getAttribute('k')] = tag.getAttribute('v');
      });

      const houseNumber = tags['addr:housenumber'];
      const street = tags['addr:street'] || tags['addr:full'];

      if (houseNumber && street) {
        // For relations, find center via members
        const members = rel.querySelectorAll('member');
        let sumLat = 0, sumLon = 0, count = 0;
        members.forEach(member => {
          const ref = member.getAttribute('ref');
          if (nodeMap[ref]) {
            sumLat += nodeMap[ref].lat;
            sumLon += nodeMap[ref].lon;
            count++;
          }
        });

        const lat = count > 0 ? sumLat / count : null;
        const lon = count > 0 ? sumLon / count : null;

        if (lat != null && lon != null) {
          const streetId = normalizeStreetName(street);
          if (!streets[street]) {
            streets[street] = streetId;
            streetNames[streetId] = street;
          }
          features.push({
            number: String(houseNumber).toLowerCase(),
            street: streetId,
            streetRaw: street,
            houseNumberRaw: String(houseNumber),
            lat: lat,
            lon: lon,
            source: 'osm'
          });
        }
      }
    });

    console.log(`[OSM] Loaded ${features.length} addresses (XML)`);
    resolve({ features, streets, streetNames });
  }

  // Process OSM JSON elements
  function processOSMElements(elements, resolve) {
    const features = [];
    const streetNames = {};
    const streets = {};

    // First pass: collect all node coordinates
    const nodeMap = {};
    for (const el of elements) {
      if (el.type === 'node') {
        nodeMap[el.id] = { lat: el.lat, lon: el.lon };
      }
    }

    for (const el of elements) {
      const tags = el.tags || {};
      const houseNumber = tags['addr:housenumber'];
      const street = tags['addr:street'] || tags['addr:full'];

      if (!houseNumber || !street) continue;

      let lat, lon;
      if (el.type === 'node') {
        lat = el.lat;
        lon = el.lon;
      } else if (el.type === 'way' || el.type === 'relation') {
        // Calculate center from member/nd nodes
        const refs = el.nodes || (el.members ? el.members.map(m => (typeof m === 'object') ? m.ref || m.node : m).filter(Boolean) : []);
        let sumLat = 0, sumLon = 0, count = 0;
        for (const ref of refs) {
          if (nodeMap[ref]) {
            sumLat += nodeMap[ref].lat;
            sumLon += nodeMap[ref].lon;
            count++;
          }
        }
        if (count === 0) continue;
        lat = sumLat / count;
        lon = sumLon / count;
      } else {
        continue;
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
        houseNumberRaw: String(houseNumber),
        lat: lat,
        lon: lon,
        source: 'osm'
      });
    }

    console.log(`[OSM] Loaded ${features.length} addresses (JSON)`);
    resolve({ features, streets, streetNames });
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
    let restrictionsDiv = null;
    
    // Last restriction reason when RPP cannot be added
    let lastRestriction = null;

    // Batch context: remembers source+street from last normal click for Alt+click batch mode
    let batchContext = { source: null, street: null };

    // Capture Alt key from real DOM event (WME SDK strips modifier keys)
    let altClickPending = false;
    document.addEventListener('mousedown', (e) => {
      altClickPending = e.altKey;
    }, { capture: true, passive: true });

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

      // Alt+click = create 1 RPP for clicked marker + batch all other unprocessed
      if (altClickPending) {
        altClickPending = false;
        // First create single RPP (saves source+street to batchContext)
        onFeatureClick(bestFeature);
        // Then batch all remaining unprocessed of same source+street
        batchCreateRPP(bestFeature.source || 'waze');
        return;
      }

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
        const street = found.streetRaw || found.settlement || '';
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

    // === End Map Tooltip ===

    /**
         * Core RPP creation logic — extractable for single and batch modes.
         * @param {object} feature - Feature object with number, street, lat, lon, etc.
         * @param {boolean} silent - When true, skip toast for validation failures (batch mode).
         * @returns {{houseNumber: string, streetId: number}|null} Result object on success, null on validation skip.
         */

        // Calculate distance to segment (in pixels) — extracted for reuse in findNearestNamedSegment
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

        // Find the nearest named segment (skip unnamed roads)
        function findNearestNamedSegment(lat, lon, segments) {
          let bestSeg = null;
          let bestDist = Infinity;
          for (const seg of segments) {
            const street = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
            if (!street?.name) continue;
            const nameLower = street.name.toLowerCase().trim();
            if (/^(unnamed road|дорога без назви|дорога без імені|—|без назви)$/i.test(nameLower)) continue;
            // Check real-world distance (perpendicular), skip if >500m
            if (seg.geometry?.coordinates?.length > 0) {
              const segDistKm = minDistanceToSegment(lat, lon, seg);
              if (segDistKm > 0.5) continue;
              if (segDistKm < bestDist) {
                bestDist = segDistKm;
                bestSeg = seg;
              }
            }
          }
          return bestSeg;
        }

        function createSingleRPP(feature, silent, forceUseNearest) {
          if (feature.processed) return null;
          if (typeof feature.lat !== 'number' || typeof feature.lon !== 'number' || isNaN(feature.lat) || isNaN(feature.lon)) {
            if (!silent) console.warn('[UA-RPP] Invalid coordinates for feature:', feature);
            return null;
          }

          const houseNumber = normalizeHouseNumber(feature.number);
          const featureLon = feature.lon;
          const featureLat = feature.lat;

          // Find the nearest segment to get the street
          const segments = wmeSDK.DataModel.Segments.getAll();

          let nearestStreetId = null;
          let nearestSegment = null;
          let minDist = Infinity;

          // Convert feature coords to pixel coords
          const featurePx = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: featureLon, lat: featureLat } });
          if (!featurePx) {
            if (!silent) console.warn('[UA-RPP] Cannot convert feature coords to pixels');
            return null;
          }

          for (const seg of segments) {
            const coords = seg.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) continue;

            for (let i = 0; i < coords.length - 1; i++) {
              const p1 = coords[i];
              const p2 = coords[i + 1];
              if (!p1 || !p2) continue;

              const p1Px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: p1[0], lat: p1[1] } });
              const p2Px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: p2[0], lat: p2[1] } });

              const dist = pointToSegmentDist(featurePx.x, featurePx.y, p1Px.x, p1Px.y, p2Px.x, p2Px.y);
              if (dist < minDist) {
                minDist = dist;
                nearestStreetId = seg.primaryStreetId;
                nearestSegment = seg;
              }
            }
          }

          if (!nearestStreetId) {
            const msg = 'Не знайдено сегментів поруч з цим маркером';
            if (!silent) toast(msg, 'warning');
            else console.warn('[UA-RPP]', msg);
            return null;
          }

          // Check if street has a name (RPP cannot be created without street name)
          const street = wmeSDK.DataModel.Streets.getById({ streetId: nearestStreetId });

          const streetNameLower = street?.name?.toLowerCase() || '';
          const isNamedUnnamed = streetNameLower && 
              /^(unnamed road|дорога без назви|дорога без імені|—|без назви)$/i.test(streetNameLower.trim());
          if (isNamedUnnamed) {
            // In single-click mode, try to find nearest named segment instead of aborting
            if (forceUseNearest) {
              const namedSeg = findNearestNamedSegment(feature.lat, feature.lon, segments);
              if (namedSeg) {
                nearestStreetId = namedSeg.primaryStreetId;
                nearestSegment = namedSeg;
                console.log(`[UA-RPP] Nearest segment unnamed, using nearest named: ${wmeSDK.DataModel.Streets.getById({ streetId: nearestStreetId })?.name}`);
              } else {
                const msg = 'Сегмент "Дорога без назви" — RPP не можна створити';
                if (!silent) toast(msg, 'warning');
                else console.warn('[UA-RPP]', msg);
                return null;
              }
            } else {
              const msg = 'Сегмент "Дорога без назви" — RPP не можна створити';
              if (!silent) toast(msg, 'warning');
              else console.warn('[UA-RPP]', msg);
              return null;
            }
          }

          // If segment lacks street name, use the one from the marker
          let effectiveStreetName = null;
          let useMarkerStreet = false;

          if (!street || !street.name) {
            if (feature.streetRaw) {
              effectiveStreetName = feature.streetRaw;
              useMarkerStreet = true;
            } else {
              const msg = 'Сегмент без назви вулиці — RPP не можна створити';
              if (!silent) toast(msg, 'warning');
              else console.warn('[UA-RPP]', msg);
              return null;
            }
          }

          // Clean Visicom street names (remove old name in parentheses)
          if (useMarkerStreet || feature.source === 'visicom') {
            effectiveStreetName = cleanStreetName(effectiveStreetName || street?.name);
          }

          // If using marker's street name, try to find matching street in WME within 300m radius
          let streetId = nearestStreetId;
          let foundMatchingStreet = false;
          let foundViaAlt = false;

          // If marker's street name matches an alternate of any nearby segment,
          // use the primary street — the marker's street is an outdated alias.
          // Run this even when nearest segment is unnamed (useMarkerStreet=true) —
          // the marker's street might match an alternate on a nearby named segment.
          if (feature.streetRaw) {
            const normalizedMarker = normalizeForComparison(cleanStreetName(feature.streetRaw));
            const allSegments = wmeSDK.DataModel.Segments.getAll();
            foundViaAlt = false;
            for (const seg of allSegments) {
              if (!seg.alternateStreetIds?.length || !seg.primaryStreetId) continue;
              // Only consider segments within 300m of the marker
              if (feature.lat && feature.lon && seg.geometry?.coordinates?.length > 0) {
                if (minDistanceToSegment(feature.lat, feature.lon, seg) > 0.3) continue;
              }
              // Check if this segment has the marker's street as an alternate
              for (const altId of seg.alternateStreetIds) {
                const altStreet = wmeSDK.DataModel.Streets.getById({ streetId: altId });
                if (altStreet?.name) {
                  const normalizedAlt = normalizeForComparison(altStreet.name);
                  // Exact match first
                  if (!foundViaAlt && normalizedAlt === normalizedMarker) {
                    const primaryStreet = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
                    if (primaryStreet?.name && normalizeForComparison(primaryStreet.name) !== normalizedMarker) {
                      streetId = seg.primaryStreetId;
                      foundViaAlt = true;
                      console.log(`[UA-RPP] Marker street "${feature.streetRaw}" is alternate → using primary "${primaryStreet.name}"`);
                      break;
                    }
                  }
                  // Fuzzy fallback
                  if (!foundViaAlt && fuzzyStreetMatch(normalizedAlt, normalizedMarker)) {
                    const primaryStreet = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
                    if (primaryStreet?.name && !fuzzyStreetMatch(normalizeForComparison(primaryStreet.name), normalizedMarker)) {
                      streetId = seg.primaryStreetId;
                      foundViaAlt = true;
                      console.log(`[UA-RPP] Marker street "${feature.streetRaw}" fuzzy-matched alternate → using primary "${primaryStreet.name}"`);
                      break;
                    }
                  }
                }
              }
              if (foundViaAlt) break;
            }
          }
          // If marker's street name matches a PRIMARY of any nearby segment and differs
          // from the nearest segment's street, prefer the marker's street (source data)
          if (feature.streetRaw && !useMarkerStreet && streetId === nearestStreetId && street?.name) {
            const normalizedMarker = normalizeForComparison(cleanStreetName(feature.streetRaw));
            const normalizedNearest = normalizeForComparison(street.name);
            if (normalizedMarker !== normalizedNearest) {
              const allSegments = wmeSDK.DataModel.Segments.getAll();
              let foundCornerMatch = false;
              for (const seg of allSegments) {
                if (!seg.primaryStreetId) continue;
                const primaryStreet = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
                if (primaryStreet?.name) {
                  const normalizedPrimary = normalizeForComparison(primaryStreet.name);
                  // Exact match first
                  if (!foundCornerMatch && normalizedPrimary === normalizedMarker) {
                    // Check distance — use min distance to any point of segment geometry
                    let withinRange = false;
                    if (feature.lat && feature.lon && seg.geometry?.coordinates?.length > 0) {
                      const d = minDistanceToSegment(feature.lat, feature.lon, seg);
                      if (d <= 0.3) withinRange = true;
                    }
                    if (withinRange) {
                      streetId = seg.primaryStreetId;
                      foundCornerMatch = true;
                      console.log(`[UA-RPP] Marker street "${feature.streetRaw}" matches primary — using instead of nearest "${street.name}"`);
                      break;
                    }
                  }
                  // Fuzzy fallback
                  if (!foundCornerMatch && fuzzyStreetMatch(normalizedPrimary, normalizedMarker)) {
                    let withinRange = false;
                    if (feature.lat && feature.lon && seg.geometry?.coordinates?.length > 0) {
                      const d = minDistanceToSegment(feature.lat, feature.lon, seg);
                      if (d <= 0.3) withinRange = true;
                    }
                    if (withinRange) {
                      streetId = seg.primaryStreetId;
                      foundCornerMatch = true;
                      console.log(`[UA-RPP] Marker street "${feature.streetRaw}" fuzzy-matched primary — using instead of nearest "${street.name}"`);
                      break;
                    }
                  }
                }
              }
            }
          }

          // If marker specified a street and resolved street doesn't match — skip
          // BUT only if the match wasn't found via alternate street names (e.g. Більшовицька ↔ Дубовиця)
          // In single-click mode (forceUseNearest), skip this check — just use nearest segment street
          if (!forceUseNearest && feature.streetRaw && !useMarkerStreet && streetId === nearestStreetId && !foundViaAlt) {
            const nearestStreet = wmeSDK.DataModel.Streets.getById({ streetId: nearestStreetId });
            if (nearestStreet?.name) {
              const normalizedResolved = normalizeForComparison(cleanStreetName(nearestStreet.name));
              const normalizedMarker = normalizeForComparison(cleanStreetName(feature.streetRaw));
              if (!fuzzyStreetMatch(normalizedResolved, normalizedMarker)) {
                const msg = `Маркер "${feature.streetRaw}" — RPP буде створено на "${nearestStreet.name}". Пропускаємо, перевір вручну.`;
                if (!silent) toast(msg, 'warning');
                else console.warn('[UA-RPP]', msg);
                feature.processed = true;
                return null;
              }
            }
          }

          // If we already found a matching street via alternate names, skip this search
          if (useMarkerStreet && effectiveStreetName && !foundViaAlt) {
            const normalizedMarkerStreet = normalizeForComparison(effectiveStreetName);
            const allSegments = wmeSDK.DataModel.Segments.getAll();
            const streetIds = new Set();
            for (const seg of allSegments) {
              if (feature.lat && feature.lon && seg.geometry) {
                const segDist = minDistanceToSegment(feature.lat, feature.lon, seg);
                if (segDist > 0.5) continue; // 500m radius for street name matching
              }
              if (seg.primaryStreetId) streetIds.add(seg.primaryStreetId);
              (seg.alternateStreetIds || []).forEach(id => streetIds.add(id));
            }
            // First pass: check if matched street is an alternate of any nearby segment
            // If so, use the PRIMARY street instead (e.g. "Малинова" → "Івана Дзюби")
            for (const id of streetIds) {
              const wmeStreet = wmeSDK.DataModel.Streets.getById({ streetId: id });
              if (wmeStreet?.name && normalizeForComparison(wmeStreet.name) === normalizedMarkerStreet) {
                // Check if this street ID is an alternate of a nearby segment
                let foundPrimary = false;
                for (const seg of allSegments) {
                  if (seg.primaryStreetId === id) continue; // skip if it IS the primary
                  if (!seg.alternateStreetIds?.length) continue;
                  if (seg.alternateStreetIds.includes(id)) {
                    // This street is an alternate — use the segment's primary
                    const primaryStreet = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
                    if (primaryStreet?.name) {
                      streetId = seg.primaryStreetId;
                      foundMatchingStreet = true;
                      foundPrimary = true;
                      console.log(`[UA-RPP] useMarker: "${effectiveStreetName}" is alternate → using primary "${primaryStreet.name}"`);
                      break;
                    }
                  }
                }
                if (!foundPrimary) {
                  // Street is a primary of some segment — use it directly
                  streetId = id;
                  foundMatchingStreet = true;
                  console.log(`[UA-RPP] useMarker: "${effectiveStreetName}" matched as primary street`);
                }
                break;
              }
            }
            // Fallback: fuzzy match if exact didn't work
            if (!foundMatchingStreet) {
              for (const id of streetIds) {
                const wmeStreet = wmeSDK.DataModel.Streets.getById({ streetId: id });
                if (wmeStreet?.name) {
                  const wmeNorm = normalizeForComparison(wmeStreet.name);
                  if (fuzzyStreetMatch(wmeNorm, normalizedMarkerStreet)) {
                    // Same logic: if alternate → use primary
                    let foundPrimary = false;
                    for (const seg of allSegments) {
                      if (seg.primaryStreetId === id) continue;
                      if (!seg.alternateStreetIds?.length) continue;
                      if (seg.alternateStreetIds.includes(id)) {
                        const primaryStreet = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
                        if (primaryStreet?.name) {
                          streetId = seg.primaryStreetId;
                          foundMatchingStreet = true;
                          foundPrimary = true;
                          console.log('[UA-RPP] Fuzzy useMarker: ', wmeStreet.name, '≈', effectiveStreetName, '→ primary', primaryStreet.name);
                          break;
                        }
                      }
                    }
                    if (!foundPrimary) {
                      streetId = id;
                      foundMatchingStreet = true;
                      console.log('[UA-RPP] Fuzzy match:', wmeStreet.name, '≈', effectiveStreetName);
                    }
                    break;
                  }
                }
              }
            }
            if (!foundMatchingStreet) {
              // Last resort: try cleanStreetName on WME names too (remove parentheses)
              for (const id of streetIds) {
                const wmeStreet = wmeSDK.DataModel.Streets.getById({ streetId: id });
                if (wmeStreet?.name) {
                  const wmeNorm = normalizeForComparison(cleanStreetName(wmeStreet.name));
                  if (wmeNorm === normalizedMarkerStreet || fuzzyStreetMatch(wmeNorm, normalizedMarkerStreet)) {
                    let foundPrimary = false;
                    for (const seg of allSegments) {
                      if (seg.primaryStreetId === id) continue;
                      if (!seg.alternateStreetIds?.length) continue;
                      if (seg.alternateStreetIds.includes(id)) {
                        const primaryStreet = wmeSDK.DataModel.Streets.getById({ streetId: seg.primaryStreetId });
                        if (primaryStreet?.name) {
                          streetId = seg.primaryStreetId;
                          foundMatchingStreet = true;
                          foundPrimary = true;
                          console.log('[UA-RPP] Cleaned useMarker:', wmeStreet.name, '→', effectiveStreetName, '→ primary', primaryStreet.name);
                          break;
                        }
                      }
                    }
                    if (!foundPrimary) {
                      streetId = id;
                      foundMatchingStreet = true;
                      console.log('[UA-RPP] Cleaned match:', wmeStreet.name, '→', effectiveStreetName);
                    }
                    break;
                  }
                }
              }
            }
            if (!foundMatchingStreet) {
              // In single-click mode, fall back to nearest segment's street instead of aborting
              if (forceUseNearest) {
                // Check if nearest street is unnamed — still abort in that case
                const nearestStreetName = (wmeSDK.DataModel.Streets.getById({ streetId: nearestStreetId })?.name || '').toLowerCase().trim();
                if (/^(unnamed road|дорога без назви|дорога без імені|—|без назви)$/i.test(nearestStreetName)) {
                  const msg = 'Не знайдено вулиці з назвою біля маркера';
                  if (!silent) toast(msg, 'warning');
                  else console.warn('[UA-RPP]', msg);
                  return null;
                }
                streetId = nearestStreetId;
                console.log(`[UA-RPP] useMarker: no match for "${effectiveStreetName}", using nearest segment street`);
              } else {
                const msg = `Не знайдено вулиці "${effectiveStreetName}" в радіусі 300м`;
                if (!silent) toast(msg, 'warning');
                else console.warn('[UA-RPP]', msg);
                return null;
              }
            }
          }

          // Check for duplicates before creating
          if (LS.getNoDuplicates() && hasDuplicate(houseNumber, streetId, true)) {
            const msg = 'RPP з таким номером вже існує на цій вулиці';
            if (!silent) toast(msg, 'warning');
            else console.warn('[UA-RPP]', msg);
            return null;
          }

          // --- Snap to road logic ---
          let snapLon = feature.lon;
          let snapLat = feature.lat;
          if (LS.getSnapToRoad()) {
            const snapResult = snapToNearestRoad(feature.lon, feature.lat, streetId);
            if (snapResult) {
              snapLon = snapResult.lon;
              snapLat = snapResult.lat;
            }
            // If preferred street segments found nothing within 100m, try any segment (fallback)
            if (!snapResult && streetId) {
              const fallbackSnap = snapToNearestRoad(feature.lon, feature.lat);
              if (fallbackSnap) {
                snapLon = fallbackSnap.lon;
                snapLat = fallbackSnap.lat;
                console.warn('[UA-RPP] Snap fallback: no segments of preferred street, snapped to nearest any');
              }
            }
            // If even any-segment snap fails, keep original marker coordinates
            // Don't abort RPP creation for snap failures
          }

          const geometry = {
            type: 'Point',
            coordinates: [snapLon, snapLat]
          };

          // Create venue(s): RPP only or POI + RPP depending on checkbox
          const createVenue = (residential, geometryOverride, entryPointCoords) => {
            const g = geometryOverride || geometry;
            const coords = g.coordinates;
            const vid = wmeSDK.DataModel.Venues.addVenue({
              category: 'OTHER',
              geometry: g
            });
            wmeSDK.DataModel.Venues.updateVenue({
              venueId: String(vid),
              name: houseNumber
            });
            wmeSDK.DataModel.Venues.updateAddress({
              venueId: String(vid),
              houseNumber: houseNumber,
              streetId: streetId
            });
            if (residential) {
              wmeSDK.DataModel.Venues.updateVenueIsResidential({
                venueId: String(vid),
                isResidential: true
              });
            }
            wmeSDK.DataModel.Venues.replaceNavigationPoints({
              venueId: String(vid),
              navigationPoints: [{
                isEntry: true,
                isExit: true,
                isPrimary: true,
                name: '',
                point: { type: 'Point', coordinates: entryPointCoords || coords }
              }]
            });
            return vid;
          };

          let venueId;
          let venueIds = [];
          if (LS.getCreatePOI()) {
            const poiOffset = -0.000026;
            const poiGeometry = {
              type: 'Point',
              coordinates: [snapLon + poiOffset, snapLat]
            };
            const rppId = createVenue(true);                // RPP first
            venueIds.push(rppId);
            venueId = createVenue(false, poiGeometry, [snapLon, snapLat]);      // POI second
            venueIds.push(venueId);
          } else {
            venueId = createVenue(true);
            venueIds = [venueId];
          }

          // Lock all venues to level 2 if enabled and user has rank > 0
          if (LS.getLockRank2() && wmeSDK.State?.getUserInfo) {
            try {
              const userInfo = wmeSDK.State.getUserInfo();
              if (userInfo?.rank > 0) {
                setTimeout(() => {
                  for (const vid of venueIds) {
                    try {
                      const venue = wmeSDK.DataModel.Venues.getById({ venueId: String(vid) });
                      if (venue && venue.lockRank < 1) {
                        wmeSDK.DataModel.Venues.updateVenue({
                          venueId: String(vid),
                          lockRank: 1
                        });
                        console.log('[UA-RPP] Locked venue to level 2:', vid);
                      }
                    } catch (e2) {
                      console.warn('[UA-RPP] Could not lock venue', vid, e2);
                    }
                  }
                }, 500);
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

          return { houseNumber, streetId };
        }

        function onFeatureClick(feature) {
          try {
            const result = createSingleRPP(feature, false, true);
            if (!result) return;

            feature.userAdded = true;
            feature.processed = true;
            feature.conflict = false;
            applyFeatureFilter();

            // Remember source+street for batch mode (Alt+click)
            batchContext.source = feature.source || 'waze';
            batchContext.street = feature.street;

            toast(`Додано ${LS.getCreatePOI() ? 'POI + RPP' : 'RPP'} ${result.houseNumber} 🏠`, 'success');
          } catch (err) {
            console.error('[UA-RPP] Помилка додавання', err);
            toast(err.message || 'Помилка додавання RPP', 'error');
            lastRestriction = { number: normalizeHouseNumber(feature.number), reason: err.message };
            if (restrictionsDiv) {
              restrictionsDiv.innerHTML = `<i class="fa fa-exclamation-triangle"></i> <b>Помилка:</b> ${normalizeHouseNumber(feature.number)} — ${err.message}`;
            }
          }
        }

        /**
         * Batch-create RPPs for all unprocessed markers of the remembered source+street.
         * Triggered by Alt+click on any marker.
         */
        // Floating batch progress indicator
        let batchProgressEl = null;

        function showBatchProgress(sourceText, total) {
          if (!batchProgressEl) {
            batchProgressEl = document.createElement('div');
            batchProgressEl.id = 'qhnua-batch-progress';
            batchProgressEl.style.cssText = 'position:fixed;bottom:60px;right:20px;z-index:10001;background:rgba(0,0,0,0.85);color:#fff;padding:12px 16px;border-radius:8px;font-size:13px;min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,0.3);backdrop-filter:blur(4px);';
            document.body.appendChild(batchProgressEl);
          }
          batchProgressEl.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;">🔄 ${sourceText}</div>
            <div style="margin-bottom:4px;">0 / ${total}</div>
            <div style="height:6px;background:rgba(255,255,255,0.2);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:0%;background:#8A2BE2;border-radius:3px;transition:width 0.2s;"></div>
            </div>
          `;
          batchProgressEl.style.display = 'block';
        }

        function updateBatchProgress(done, total, successCount, failCount) {
          if (!batchProgressEl) return;
          const pct = Math.round((done / total) * 100);
          batchProgressEl.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;">🔄 ${done}/${total}</div>
            <div style="margin-bottom:4px;font-size:12px;">
              <span style="color:#0c0;">✓${successCount}</span>
              ${failCount > 0 ? ` <span style="color:#c00;">✗${failCount}</span>` : ''}
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.2);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:#8A2BE2;border-radius:3px;transition:width 0.2s;"></div>
            </div>
          `;
        }

        function hideBatchProgress(successCount, failCount, total) {
          if (!batchProgressEl) return;
          const pct = 100;
          batchProgressEl.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;">
              ${failCount === 0 ? '✅' : '⚠️'} ${successCount}/${total}
            </div>
            <div style="margin-bottom:4px;font-size:12px;">
              <span style="color:#0c0;">✓${successCount}</span>
              ${failCount > 0 ? ` <span style="color:#c00;">✗${failCount}</span>` : ''}
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.2);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:100%;background:${failCount === 0 ? '#0c0' : '#c80'};border-radius:3px;"></div>
            </div>
          `;
          setTimeout(() => {
            if (batchProgressEl) batchProgressEl.style.display = 'none';
          }, 3000);
        }

        function batchCreateRPP(source) {
          const sourceLabels = { 'waze': 'Waze', 'visicom': 'Visicom', 'osm': 'OSM' };
          const sourceText = sourceLabels[source] || source;

          if (!batchContext.street) {
            toast('Спочатку клікніть на маркер (без Alt), щоб задати вулицю', 'warning');
            return;
          }

          const batchFeatures = lastFeatures.filter(f =>
            !f.processed &&
            f.source === source &&
            f.street === batchContext.street &&
            typeof f.lat === 'number' && typeof f.lon === 'number' &&
            !isNaN(f.lat) && !isNaN(f.lon)
          );

          if (!batchFeatures.length) {
            toast(`Немає необроблених маркерів джерела ${sourceText}`, 'warning');
            return;
          }

          let successCount = 0;
          let failCount = 0;
          const total = batchFeatures.length;

          showBatchProgress(sourceText, total);

          // Process sequentially with 300ms delay between each
          batchFeatures.reduce((promise, feat, index) => {
            return promise.then(() => {
              return new Promise(resolve => {
                setTimeout(() => {
                  try {
                    const result = createSingleRPP(feat, true);
                    if (result) {
                      feat.userAdded = true;
                      feat.processed = true;
                      feat.conflict = false;
                      successCount++;
                    } else {
                      failCount++;
                    }
                  } catch (err) {
                    console.warn(`[UA-RPP batch] Помилка: ${feat.number} — ${err.message}`);
                    failCount++;
                  }
                  const done = successCount + failCount;
                  updateBatchProgress(done, total, successCount, failCount);
                  resolve();
                }, 300);
              });
            });
          }, Promise.resolve()).then(() => {
            applyFeatureFilter();
            hideBatchProgress(successCount, failCount, total);
            const successMsg = `✅ ${sourceText}: створено ${successCount}/${total} RPP` +
              (failCount > 0 ? ` (${failCount} пропущено)` : '');
            toast(successMsg, failCount > 0 && successCount === 0 ? 'warning' : 'success');

            // Update instructions with result
            if (statusDiv) {
              statusDiv.innerHTML = `<b>Пакетне створення</b><br/>` +
                `<span style="color:#080;">✓ ${successCount}</span>` +
                (failCount > 0 ? ` <span style="color:#c00;">✗ ${failCount}</span>` : '') +
                ` — ${sourceText}<br/><span style="font-size:11px;color:#666;">${total} маркерів оброблено</span>`;
            }
          });
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
      tabLabel.innerText = '▲ UA-RPP';
      tabLabel.title = 'Швидкий імпорт RPP (Україна)';

      tabPane.innerHTML = `
        <div id="qhnua-pane" style="padding:10px;">
          <h3 style="margin:0 0 8px 0;font-size:19px;"><span style="color:#8A2BE2;">▲</span> Швидкий імпорт RPP <small style="font-weight:normal;color:#aaa;">v${GM_info.script.version}</small></h3>
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
            <wz-checkbox id="hn-lock-rank2">Заблокувати (рівень 2)</wz-checkbox>
            <wz-checkbox id="hn-create-poi">Створити POI + RPP</wz-checkbox>
            <span style="display:inline-flex;align-items:center;gap:6px;"><wz-checkbox id="hn-snap-road">Підтягувати до дороги</wz-checkbox><input id="hn-snap-dist" type="number" min="1" max="200" step="1" value="20" style="width:50px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;" title="Відстань від дороги (м)"> м</span>
            <span style="color:#0066cc;font-weight:bold;">Джерела:</span> <span style="font-size:12px;">Зона пошуку <input id="qhnua-buffer" type="number" min="0" step="50" style="width:60px;margin-left:2px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;"> м</span><br/>
            <label style="margin-right:12px;"><input type="checkbox" id="qhnua-src-waze"> Waze (зелений)</label>
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

      const chkCreatePOI = tabPane.querySelector('#hn-create-poi');
      if (chkCreatePOI) {
        setChecked(chkCreatePOI, LS.getCreatePOI());
        chkCreatePOI.addEventListener('click', () => {
          const on = isChecked(chkCreatePOI);
          setChecked(chkCreatePOI, !on);
          LS.setCreatePOI(!on);
        });
      }

      const chkSnapRoad = tabPane.querySelector('#hn-snap-road');
      if (chkSnapRoad) {
        setChecked(chkSnapRoad, LS.getSnapToRoad());
        chkSnapRoad.addEventListener('click', () => {
          const on = isChecked(chkSnapRoad);
          setChecked(chkSnapRoad, !on);
          LS.setSnapToRoad(!on);
        });
      }

      const snapDistEl = tabPane.querySelector('#hn-snap-dist');
      if (snapDistEl) {
        snapDistEl.value = String(LS.getSnapDistance());
        snapDistEl.addEventListener('change', () => {
          const val = Number(snapDistEl.value);
          if (isNaN(val) || val < 1) {
            snapDistEl.value = String(LS.getSnapDistance());
            return;
          }
          LS.setSnapDistance(val);
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
        // Clear deduplication cache so reloading shows all addresses
        if (window.__uaRppSeenFeatures) window.__uaRppSeenFeatures.clear();

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
        batchContext = { source: null, street: null };
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
          
// OSM needs smaller radius (max 300m) to avoid timeouts
          const osmChecked = document.getElementById('qhnua-src-osm')?.checked;
          if (osmChecked) {
            radius = Math.min(radius, 300);
          }

          // Choose data sources (multi-select via checkboxes)
          const sources = [];
          if (document.getElementById('qhnua-src-waze')?.checked) sources.push('waze');
          if (document.getElementById('qhnua-src-visicom')?.checked) sources.push('visicom');
          if (document.getElementById('qhnua-src-osm')?.checked) sources.push('osm');
          if (sources.length === 0) {
            toast('Виберіть хоча б одне джерело даних (Waze/Visicom/OSM)', 'warning');
            loading.style.display = 'none';
            resolve();
            return;
          }

          const bounds = { minLon: lonMin, minLat: latMin, maxLon: lonMax, maxLat: latMax };

          // Separate sources: waze/visicom first (sync render), OSM second (async update)
          const primarySources = sources.filter(s => s !== 'osm');
          const fetchPromises = primarySources.map(src => {
            if (src === 'visicom') return fetchAddressesVisicom(bounds);
            return fetchAddressesWaze(centerLat, centerLon, radius);
          });

          // OSM fetched separately below (async), only waze/visicom in Promise.allSettled
          // (this safely skips any source that fails without blocking the others)

          Promise.allSettled(fetchPromises)
            .then(results => {
              // Bail out if user clicked Clear
              if (loadId !== currentLoadId) {
                loading.style.display = 'none';
                resolve();
                return;
              }
              
              // Merge results from all sources — skip any that failed
              let allFeatures = [];
              let allStreets = {};
              let allStreetNames = {};
              
              for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (r.status === 'rejected') {
                  const srcName = primarySources[i] || 'unknown';
                  console.warn(`[UA-RPP] Джерело ${srcName} недоступне, пропускаємо. Помилка:`, r.reason);
                  continue;
                }
                const apiResult = r.value;
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

              // OSM-only mode: allow empty features if OSM is enabled
              const hasPrimarySources = primarySources.length > 0;
              if (!features.length && !osmChecked) {
                loading.style.display = 'none';
                statusDiv.textContent = 'Не знайдено адрес у цьому районі.';
                resolve();
                return;
              }

              // Initialize lastFeatures (for OSM-only mode)
              lastFeatures = features;

              statusDiv.textContent = hasPrimarySources 
                ? `Знайдено: ${features.length} адрес (радіус: ${Math.round(radius)}м)`
                : 'Завантаження OSM даних...';

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

              // OSM: fetch separately and add to existing features
              if (osmChecked) {
                fetchAddressesOSM(centerLat, centerLon, radius).then(osmResult => {
                  if (loadId !== currentLoadId) return;

                  const osmFeatures = osmResult.features || [];
                  for (const item of osmFeatures) {
                    if (!item.lat || !item.lon) continue;

                    const normalizedNum = normalizeHouseNumber(item.number);
                    const featureKey = `${normalizedNum}|${item.street}`;
                    if (window.__uaRppSeenFeatures?.has(featureKey)) continue;
                    window.__uaRppSeenFeatures?.add(featureKey);

                    lastFeatures.push({
                      number: normalizedNum,
                      street: item.street,
                      streetRaw: item.streetRaw || '',
                      houseNumberRaw: item.houseNumberRaw || normalizedNum,
                      processed: false,
                      conflict: false,
                      lon: item.lon,
                      lat: item.lat,
                      source: 'osm'
                    });
                  }

                  applyFeatureFilter();
                  statusDiv.innerHTML = `Завантажено ${lastFeatures.length} адрес (включаючи OSM).<br/><b>Клікніть на номер на карті, щоб додати!</b>`;
                  loading.style.display = 'none';
                }).catch(err => {
                  console.warn('[OSM] Async fetch failed:', err);
                  loading.style.display = 'none';
                  if (!hasPrimarySources) {
                    statusDiv.textContent = 'Помилка OSM: ' + err.message;
                  }
                  // Don't show error to user - OSM is optional supplement
                });
              }

              // Ensure layer is visible after load
              lastComputedVisibility = true; // Force visibility state
              wmeSDK.Map.setLayerVisibility({ layerName: SDK_LAYER_NAME, visibility: true });
              userWantsLayerVisible = true;
              setChecked(chkVis, true);
              LS.setLayerVisible(true);

              // For primary sources: hide loading now, OSM will update status later
              if (hasPrimarySources) {
                loading.style.display = 'none';
                statusDiv.innerHTML = `Завантажено ${lastFeatures.length} адрес.<br/>` +
                  `<b>Клікніть на номер на карті, щоб додати!</b>`;
              }
              // OSM-only: loading stays visible until OSM fetch completes (lines 1473-1480)
              resolve();
            })
            .catch(err => {
              console.error('[UA-RPP] Помилка обробки даних:', err);
              loading.style.display = 'none';
              if (loadId === currentLoadId) {
                toast(`❌ Помилка: ${err.message || 'невідома помилка'}`, 'error');
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