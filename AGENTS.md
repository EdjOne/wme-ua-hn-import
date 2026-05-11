# house-number (UA-HN)

**Владелец:** Mr. Edj  
**Создан:** 2026-05-02

## 📋 Описание

Адаптация Tampermonkey userscript'а **WME Quick HN Importer** (Словения) для Waze Map Editor под украинские стандарты адресации.

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
│   └── ua-hn-import.user.js  # v1.3.2 (исправлено сопоставление названий улиц с суффиксами)
└── data/
    └── test-bbox.json
```

## ✅ Статус

- [x] Парсер улиц из текста
- [x] Геокодинг OSM Nominatim
- [x] WME permalink generator
- [x] Telegram бот
- [ ] Деплой на сервер