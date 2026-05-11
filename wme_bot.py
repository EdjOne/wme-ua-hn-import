#!/usr/bin/env python3
"""WME Street Highlighter - Telegram бот."""

import os
import re
import logging
from flask import Flask, request, jsonify
from telegram import Update, Bot
from telegram.ext import Application, MessageHandler, filters, ContextTypes

from street_extractor import extract_streets, build_wme_permalink, detect_city

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
bot = Bot(TOKEN) if TOKEN else None

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обрабатывает входящие сообщения."""
    text = update.message.text
    
    if not text and update.message.caption:
        text = update.message.caption
    
    if not text:
        await update.message.reply_text("Пришлите текст с улицами")
        return
    
    # Извлекаем улицы
    result = extract_streets(text)
    streets = result['streets']
    
    if not streets:
        await update.message.reply_text("Улицы не найдены в тексте")
        return
    
    city = detect_city(text)
    wme = build_wme_permalink(streets, city, geocode=True)
    
    # Формируем ответ
    msg = f"🔍 Найдено улиц: {len(streets)}\n"
    msg += "\n".join(f"• {s}" for s in sorted(streets))
    msg += f"\n\n📍 WME: {wme['permalink']}"
    
    if wme['geocoded']:
        msg += f"\n\n📌 Геокодировано: {len(wme['geocoded'])}"
    
    await update.message.reply_text(msg, disable_web_page_preview=False)

# Flask API
app = Flask(__name__)

@app.route('/api/extract', methods=['POST'])
def api_extract():
    """API endpoint для извлечения улиц."""
    data = request.json
    text = data.get('text', '')
    
    if not text:
        return jsonify({'error': 'text required'}), 400
    
    result = extract_streets(text)
    streets = result['streets']
    city = detect_city(text)
    wme = build_wme_permalink(streets, city, geocode=True)
    
    return jsonify({
        'streets': list(streets),
        'segments': [{'street': s.street.normalized, 
                      'from': s.from_street, 
                      'to': s.to_street} for s in result['segments']],
        'intersections': [{'s1': i.street1.normalized, 
                          's2': i.street2.normalized} for i in result['intersections']],
        'permalink': wme['permalink'],
        'city': city,
        'geocoded': wme['geocoded']
    })

@app.route('/health')
def health():
    return 'OK'

def main():
    if not TOKEN:
        print("TELEGRAM_BOT_TOKEN required")
        return
    
    # Запускаем бота
    app_bot = Application.builder().token(TOKEN).build()
    app_bot.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    
    print("Bot started...")
    app_bot.run_polling()

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--api':
        app.run(host='0.0.0.0', port=5000)
    else:
        main()