# house-number (UA-HN)

**Владелец:** Mr. Edj
**Создан:** 2026-05-02

## 📋 Описание

Адаптация Tampermonkey userscript'а **WME Quick HN Importer** (Словения) для Waze Map Editor под украинские стандарты адресации.

**Исходный репозиторий:** https://github.com/zigapovhe/wme-sl-hn-import
**Исходный скрипт:** `repo/wme-sl-hn-import.user.js` (v2.2.0)

## 🗂️ Структура

```
~/projects/house-number/
├── AGENTS.md
├── repo/                     # Клон исходного репозитория (Словения)
│   ├── wme-sl-hn-import.user.js
│   └── README.md, LICENSE, icons, screenshot
├── waze-ua-repo/             # Клон WME-UA-address-data (укр. полигоны адресов)
├── research/                 # Исследования
│   └── services.md           # Украинские адресные сервисы
├── src/
│   └── ua-hn-import.user.js  # ✅ v1.1.1 — Overpass API (overpass.kumi.systems)
└── data/
    └── test-bbox.json        # Тестовые bbox для отладки
```

## 🔬 Исследование — украинские адресные сервисы

### Проверенные варианты

| Сервис | Статус | CORS | Пригодность |
|--------|--------|------|-------------|
| **OpenStreetMap (Overpass API)** | ✅ Работает | ❌ Нет CORS, но GM_xmlhttpRequest обходит | Bulk-загрузка номеров по bbox |
| **Nominatim (OSM)** | ✅ Работает | ✅ * | Reverse geocode (поштучно) |
| **Dobrepole API** | ❌ NXDOMAIN | — | Недоступен |
| **nominatim.osm.org.ua** | ❌ NXDOMAIN | — | Недоступен |
| **НАІС / Держреєстр адрес** | ⚠️ Сложно | Ограничен | Офіційний, але нестабільний |

**Вывод:** Используем **Overpass API** как основной источник.

### Почему Overpass API

- Возвращает `addr:housenumber` и `addr:street` для Украины (данные из OSM)
- Работает через POST с bbox — можно получить все номера в области за 1 запрос
- Координаты сразу в WGS84 (EPSG:4326) — **никакой перепроекции не нужно**
- Tampermonkey `GM_xmlhttpRequest` НЕ ограничен CORS (достаточно `@connect`)
- Ограничение: ~10 000 элементов на запрос (решается разбивкой bbox)

### Пример Overpass запроса
```
POST https://overpass-api.de/api/interpreter
Body: [out:json]; node["addr:housenumber"](50.448,30.520,50.452,30.527); out body;
```

**Ответ (сокращённо):**
```json
{
  "elements": [
    {
      "type": "node",
      "id": 12345,
      "lat": 50.448,
      "lon": 30.521,
      "tags": {
        "addr:housenumber": "6",
        "addr:street": "Прорізна вулиця"
      }
    }
  ]
}
```

### CRS / Проекция для Украины

- **EPSG:4326** (WGS84) — стандарт, используется в Overpass и WME
- **EPSG:6316** (UAS-2000) — государственная система Украины (не нужна для скрипта)
- Словенский скрипт использует ESPG:3794 → для Украины просто WGS84

## 🔄 Что нужно изменить в скрипте

### 1. 📍 API-слой
| Параметр | Было (Словения) | Стало (Украина) |
|----------|-----------------|-----------------|
| API URL | `ipi.eprostor.gov.si` OGC API | `overpass-api.de` POST |
| Формат запроса | `GET /items?filter=...&limit=...` | `POST /api/interpreter` |
| Поля данных | `HS_STEVILKA`, `HS_DODATEK` | `tags.addr:housenumber` |
| Название улицы | `ULICA_NAZIV`, `NASELJE_NAZIV` | `tags.addr:street`, `tags.addr:city` |
| Координаты | `E`, `N` (EPSG:3794) | `lat`, `lon` (EPSG:4326) |

### 2. 🗺️ Проекция
- Удалить `proj4` и EPSG:3794 (проекция Словении)
- Overpass возвращает lat/lon в WGS84 — используется напрямую

### 3. 📝 Аббревиатуры улиц (Словения → Украина)

```
Словенские:            Украинские:
c. → cesta            вул. → вулиця
ul. → ulica           пров. → провулок
nab. → nabrežje       просп. → проспект
trg. → trg            бульв. → бульвар
                      пл. → площа
                      узв. → узвіз
                      шосе → шосе
                      наб. → набережна
                      м-н → майдан
```

### 4. 🖥️ UI
- Название: "UA-HN" вместо "SL-HN"
- Заголовок: "Quick HN Importer — Україна 🇺🇦"
- Тексты инструкций на украинском/русском
- Дескрипшены кнопок

### 5. 🏷️ @connect и @match
- `@connect overpass-api.de` (вместо `ipi.eprostor.gov.si`)
- `@match` для WME оставить как есть

### 6. 🔧 Логика улиц
- В EProstor улицы идут с ID, маппинг через `streets`/`streetNames`
- В Overpass addr:street — это строка, маппинг не нужен
- Сравнение: fuzzy match с украинскими аббревиатурами

## ✅ Статус

- [x] Создан репозиторий
- [x] Получена ссылка на GitHub исходного скрипта
- [x] Склонён код
- [x] Исслованы украинские сервисы адресов
- [x] Найден **stat.waze.com.ua** — API адресов от Waze Ukraine
- [x] Составлен план адаптации
- [x] Создан адаптированный скрипт **ua-hn-import.user.js** (v1.0.0)
- [x] Протестировано в WME
- [x] **Добавлен справочник переименований улиц Одессы** (381 пар) — https://odeskyividhuk.github.io/streets/

## 🚀 Быстрые команды

```bash
cd ~/projects/house-number
# Исходный скрипт
less repo/wme-sl-hn-import.user.js
```

## 💬 Общение

Чтобы продолжить:
- "Открой проект house-number"
- "Начинай адаптацию скрипта"
- "Что по плану?"
