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
│   └── ua-hn-import.user.js  # v1.7.22
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
    └── test-bbox.json

## 📌 Версії

- **v1.7.11**: Покращена дедуплікація з закругленими координатами (4 знаки ≈ 11м)
- **v1.7.12**: Дедуплікація враховує ID вулиці (item.street) у ключі
- **v1.7.13**: Дедуплікація тільки за номером + вулицею (без координат). Clear очищає кеш
- **v1.7.14**: Видалено "Вулиці в районі" (analyzeStreetMatches + кнопки → 📋)
- **v1.7.15**: Чекбокс "Тільки відсутні" тепер перевіряє наявність RPP в радіусі 10м за номером
- **v1.7.16**: Счётчик "вже в WME" враховує Venues/RPP, а не тільки House Numbers
- **v1.7.17**: Повне видалення House Numbers API — проект тепер Venues-only (RPP)
- **v1.7.21**: "Тільки відсутні" біло працювало після створення RPP — виправлено додаванням в кеш
- **v1.7.22**: RPP одразу додаються в venueMapCache, фільтр ховає їх без оновлення кешу
- **v1.7.23**: `MAX_RPP_CONFLICT_DISTANCE` виправлено (10 градусів → ~10 метрів)
- **v1.7.24**: Debug логування та покращене порівняння координат

P.S. Все HN заменены на RPP (UA-RPP).