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
│   └── ua-hn-import.user.js  # v1.7.9
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

- **v1.7.9**: Оновлено @updateURL/@downloadURL на github.com формат

P.S. Все HN заменены на RPP (UA-RPP).