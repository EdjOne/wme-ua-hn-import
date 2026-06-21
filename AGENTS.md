# house-number (UA-RPP)

**Владелец:** Mr. Edj  **Создан:** 2026-05-02

## 📋 Описание

WME Quick RPP Importer для Украины — импорт номеров домов через Venues API.

## 🚀 Новый сервис: WME Street Highlighter

**Функция:** Принимает текст из Telegram/сообщения, выделяет улицы и создаёт WME permalink.

### Как это работает:
1. Пользователь пересылает сообщение с ограничениями движения
2. Сервис парсит улицы (ул., пров., просп., бульв., пер.)
3. Геокодит через OSM Nominatim
4. Возвращает WME permalink с центром на улицах

### Компоненты:
- `street_extractor.py` — парсер и геокодер
- `wme_bot.py` — Telegram бот + Flask API

### API Usage:
```bash
curl -X POST https://your-domain.com/api/extract \
  -H "Content-Type: application/json" \
  -d '{"text": "ул. Троицкая — от ул. Канатной до ул. Маразлиевской"}'
```

### Запуск:
```bash
# Telegram бот
TELEGRAM_BOT_TOKEN=xxx python3 wme_bot.py

# API сервер
python3 wme_bot.py --api
```

## 🗂️ Структура

```
~/projects/house-number/
├── AGENTS.md
├── street_extractor.py       # парсер улиц + геокодинг
├── wme_bot.py                # Telegram бот + API
├── repo/                     # код Словении (оригинал)
├── src/
`├── ua-hn-import.user.js  # v1.8.85`
```

## ✅ Статус

- [x] Парсинг nameParts із address_map.php
- [x] Получення cityId через street вмісті segment
- [x] Захист: RPP не створюється якщо вулиця без назви
- [x] Видалено функціонал navpoints
- [x] Перейменовані UI елементи (UA-HN → UA-RPP)
- [x] Дедуплікація адрес за номером, вулицею та координатами
- [x] Оновлено @updateURL/@downloadURL на github.com формат
└── data/

## 📌 Версії

- **v1.7.11**: Покращена дедуплікація з закругленими координатами (4 знаки ≈ 11м)
- **v1.7.12**: Дедуплікація враховує ID вулиці (item.street) у ключі
- **v1.7.13**: Дедуплікація тільки за номером + вулицею (без координат). Clear очищає кеш
- **v1.7.14**: Видалено "Вулиці в районі" (analyzeStreetMatches + кнопки → 📋)
- **v1.7.15**: Відокремлено обробку RPP (Venues-only) від старих House Numbers API
- **v1.7.16**: Проект повністю Venues-only (RPP) — House Numbers API видалено
- **v1.7.28**: Видалено чекбокс "Тільки відсутні" — не працював через проблеми з Venues API
- **v1.7.29**: Видалено чекбокс "Тільки обрані" — фільтр за вулицею достатній
- **v1.7.30**: Додано баннер "Made in Ukraine" в панель під інструкцією
- **v1.7.31**: Оновлено відображення баннеру в боковій панелі
- **v1.7.32**: Зменшено розмір шрифту в банері (11px → 10px)
- **v1.7.33**: Банер у вигляді прапорта України (синя/жовта полоски)
- **v1.7.34**: Виправлено банер — рівні полоски (50/50), жирний шрифт
- **v1.7.35**: Додано назву скрипта та версію в шапку панелі
- **v1.7.36**: Додано посилання на GitHub в шапку панелі
- **v1.7.37**: Банер на всю ширину, "made in"/"Ukraine" на окремих рядках
- **v1.7.38**: Збільшено розмір шрифту в банері (11px → 13px)
- **v1.7.39**: Шрифт 20px, паддинг 8px
- **v1.7.40**: Шрифт 25px, без жирного стилю
- **v1.7.41**: Видалено версію з шапки, флаг → RPP бейдж
- **v1.7.42**: RPP як простий текст без бейджа
- **v1.7.43**: RPP → ▶ (треугольник)
- **v1.7.44**: ▶ → ▲ (повернутий на 90°)
- **v1.7.45**: Видалено блок STREET_RENAMES (Odessa rename mapping)
- **v1.7.46**: Колір трьохкутика ▲ змінено на фіолетовий (#8A2BE2)
- **v1.7.47**: Змінено логіку: тепер завантаження по видимих bounds карти замість вибору сегмента
- **v1.7.48**: Виправлено getMapExtent (_northEast/_southWest), додано дебаг радіусу
- **v1.7.49**: Оновлено для Tampermonkey
- **v1.7.50**: Виправлено ReferenceError (selectedSegments)
- **v1.7.51**: Додано "Не створювати дублікати" (перевірка houseNumber + streetId)
- **v1.7.52**: Додано поле вводу API ключа Visicom
- **v1.7.53**: Переключення джерела (select) + поле не password
- **v1.7.54**: Додано fetchAddressesVisicom (потрібен API ключ)
- **v1.7.55**: Додано debug Visicom API (статус + response)

- **v1.7.56**: Виправлено ReferenceError в onerror (response)
- **v1.7.57**: Visicom API 5.0 (geocode.json з wme-e50)
- **v1.7.58**: Додано debug кількості адрес + детальні помилки JSON
- **v1.7.59**: Visicom вимкнено (CORS limit) — залишив Waze
- **v1.7.60**: Visicom через GM.xmlHttpRequest з responseType: 'json'
- **v1.7.61**: Додано @connect api.visicom.ua, @grant GM ✅ Visicom працює!
- **v1.7.62**: @icon/@icon64 → base64 data URI, @name → WME UA-RPP, @author → EdjOne, Sapozhnik, Hermes Agent AI
- **v1.7.63**: Лог відхилень RPP — відображається одразу після інструкції (остання помилка: сегмент без назви/далеко/дубль)
- **v1.7.64**: Клікабельне посилання "Отримати тут" для API ключа Visicom
- **v1.7.65**: Нова іконка (відлуння тематики WME)
- **v1.7.66**: Підготовка до оновлення іконки (очікується base64)
- **v1.7.67**: Оновлено іконку — пурпурний трикутник на прозорому фоні (96x96, без фонового кольору)
- **v1.7.68**: SVG-іконка замість PNG для гарантованої прозорості
- **v1.7.69**: Спрощений SVG-трикутник (purple #8A2BE2 на прозорому фоні)
- **v1.7.70**: Tooltip при наведенні на маркери (місто, вулиця, номер)
- **v1.8.22**: Актуальна версія скрипта
- **v1.8.23**: Додано опцію блокування RPP рівнем 2 після створення
- **v1.8.25**: Оновлено версію та доопрацьовано функціонал
- **v1.8.26-1.8.29**: Multi-source loading (Waze/Visicom/OSM checkboxes), colored markers per source, tooltip with source
- **v1.8.30**: Updated tooltip format (Source: Address), legend text (Visicom жовтий)
- **v1.8.31**: Zoom level lowered to 17 for markers, source checkbox settings persist in localStorage
- **v1.8.32**: Tooltip uses streetRaw/houseNumberRaw (original names without underscores)
- **v1.8.33**: Added streetRaw/houseNumberRaw to features pushed during merge (all sources)
- **v1.8.34**: Fixed tooltip fallback (no more underscores from normalized street field)
- **v1.8.35**: Tooltip fallback to settlement when streetRaw empty (rural addresses)
- **v1.8.36**: Load button clears deduplication cache before fetching (refresh works correctly)
- **v1.8.37**: OSM API - detect XML error responses instead of JSON parse failure
- **v1.8.38**: OSM Overpass API fallback servers (kumi.systems → overpass-api.de) with retry logic
- **v1.8.39**: Added overpass.openstreetmap.ru as third fallback server
- **v1.8.40**: OSM radius limited to 300m, timeout reduced to 30s
- **v1.8.41**: OSM loads asynchronously after Waze/Visicom (faster initial display)
- **v1.8.42**: Fixed OSM-only mode - when only OSM is selected, Waze/Visicom points no longer show
- **v1.8.43**: Removed `checked` from Waze checkbox, added OSM to sources array (OSM-only mode works correctly)
- **v1.8.44**: If segment has no street name, use marker's street name; for Visicom remove old name in parentheses (e.g., "Нова (Стара)" → "Нова")
- **v1.8.45**: Fix ReferenceError - declare restrictionsDiv at init()
- **v1.8.46**: Bump version (merge fix)
- **v1.8.47**: "Unnamed road" segments should not create RPP
- **v1.8.48**: Fixed syntax error in unnamed road check regex
- **v1.8.49**: Added debug log for street name from segment
- **v1.8.50**: Empty street name uses marker street; search 300m radius
- **v1.8.51**: If no matching street found within 300m, don't create RPP
- **v1.8.52**: Added calculateDistance function (Haversine formula)
- **v1.8.53**: Replaced throw new Error with console.warn + toast + return — no more red console errors for normal situations (300m radius, Unnamed road, duplicates)
- **v1.8.58**: Fixed bug where clicking Load without selecting any source would load Waze by default - now shows warning toast
- **v1.8.59**: OSM async fetch (removed double-fetch from Promise.all), added 4th fallback server (overpass.openstreetmap.org), timeout increased to 60s
- **v1.8.60**: Version bump, added maps.mail.ru fallback, timeout 120s, OSM temporarily disabled (blocked by CORS)
- **v1.8.61**: OSM переключён на api.openstreetmap.org (вместо Overpass) - работает без CORS, использует XML/JSON bbox запрос
- **v1.8.62**: Додано чекбокс "Підтягувати до дороги" - якщо маркер ≤100м від сегмента, RPP створюється на 10м від дороги (в бік маркера)
- **v1.8.63**: Вамп білду
- **v1.8.64**: Додано поле вводу дистанції підтягування до дороги (замість хардкоду 10м)
- **v1.8.65**: Дефолт дистанції 20м
- **v1.8.78**: Версія скрипта відображається в заголовку панелі (Швидкий імпорт ▲ v1.8.78)
- **v1.8.79**: Ctrl+click → двойной клик по маркеру для батч-створення RPP
- **v1.8.80**: Зменшено шрифт заголовка (h2 14px, версія 10px) для поміщення в один рядок
- **v1.8.81**: Batch тригер: double-click → Alt+click на маркері
- **v1.8.82**: Alt+click тепер створює 1 RPP + батчить решту (одним кліком)
- **v1.8.83**: Alt/Option+click: перехоплення модифікатора через DOM (не через WME SDK)
- **v1.8.84**: Батч фільтрує за source клікнутого маркера, а не batchContext
- **v1.8.85**: Плаваюче вікно прогресу батч-створення RPP (прогрес-бар + лічильник)
- **v1.8.88**: Перша спроба — використовувати primary street якщо назва маркера збігається з альтернативою (зламана через NaN distance)
- **v1.8.89**: Виправлено — пошук серед усіх сегментів, якщо назва маркера збігається з alternate, використовується primary street сегмента
- **v1.8.90-1.8.97**: Поліпшення snap-to-road (фільтрація за streetId, fuzzy-матчінг, дистанційний фільтр)
- **v1.8.98**: Видалено "Створити POI + RPP" — скрипт тепер створює RPP напряму, без POI
- **v1.8.99**: RPP створюється одразу після addVenue (updateVenueIsResidential викликається до name/address/nav)

P.S. Все HN заменены на RPP (UA-RPP).