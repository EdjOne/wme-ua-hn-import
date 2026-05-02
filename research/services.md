# Украинские адресные сервисы для WME Quick HN Importer

## Проверенные сервисы (май 2026)

### 1️⃣ Overpass API (OSM) — ✅ РЕКОМЕНДОВАНО

**URL:** `https://overpass-api.de/api/interpreter`

**Формат:** POST, Content-Type: `application/x-www-form-urlencoded`
```
data=[out:json]; node["addr:housenumber"](bbox); out body;
```

**Данные:**
- `tags.addr:housenumber` — номер дома (пример: "6", "28/2", "7/11")
- `tags.addr:street` — название улицы (пример: "вулиця Хрещатик")
- `lat`, `lon` — координаты в WGS84 (EPSG:4326)

**Ограничения:**
- ~10 000 элементов на запрос (можно увеличить через `maxsize:`)
- Нет CORS, но Tampermonkey GM_xmlhttpRequest не требует CORS

**Плюсы:** Лучшие данные для Украины, бесплатно, bulk по bbox
**Минусы:** Нужна пагинация для больших районов

### 2️⃣ Nominatim (OSM) — Для reverse geocode

**URL:** `https://nominatim.openstreetmap.org/reverse`

**Формат:** GET
```
/reverse?lat=50.45&lon=30.52&format=json&addressdetails=1&zoom=18
```

**CORS:** ✅ `access-control-allow-origin: *`

**Плюсы:** CORS работает, простой API
**Минусы:** House number только если точка на здании, 1 запрос/с

### ❌ Недоступны (май 2026)

- `addresses.dobrepole.com.ua` — NXDOMAIN
- `nominatim.osm.org.ua` — NXDOMAIN
- `overpass.kumi.systems` — не проверялся

### ⚠️ НАІС / Держреєстр адрес

Официальный реестр — потенциально лучший источник, но:
- Требует разбирательства с WFS/OGC
- CORS скорее всего нет
- API нестабилен
- Не приоритет для первой версии
