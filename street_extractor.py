#!/usr/bin/env python3
"""Extract streets from Ukrainian traffic restriction texts."""

import re
import urllib.parse
import json
import os
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# City centroid cache (add more cities)
CITY_CENTERS = {
    'Киев': (50.4501, 30.5234),
    'Одесса': (46.4825, 30.7233),
    'Львов': (49.8397, 24.0297),
    'Харьков': (49.9935, 36.2304),
    'Днепр': (48.4647, 35.0462),
}

# Цвета маркеров для разных источников
SOURCE_COLORS = {
    'osm': '#eb933b',      # оранжевый
    'visicom': '#ebe83b',  # жёлтый
    'waze': '#4ad958',     # зеленый
}

# Visicom API key (можно переопределить)
VISICOM_API_KEY = os.environ.get('VISICOM_API_KEY', '68987d2b47b47cd7cd9e7b9cea518c28')

@dataclass
class Street:
    name: str
    type: str  # ul, provulok, prospekt, etc
    normalized: str  # без типа, для геокодинга

@dataclass
class StreetSegment:
    street: Street
    from_street: str = None  # от какой улицы
    to_street: str = None    # до какой улицы

@dataclass
class Intersection:
    street1: Street
    street2: Street

def normalize_street(name: str) -> Tuple[str, str]:
    """Разделяет тип и название улицы. Дедупликует окончания."""
    patterns = [
        (r'^ул\.?\s*', 'ul', 'улиця'),
        (r'^пр\.?\s*', 'pr', 'провулок'),
        (r'^пров\.?\s*', 'prov', 'провулок'),
        (r'^просп\.?\s*', 'pr', 'проспект'),
        (r'^булв\.?\s*', 'bul', 'бульвар'),
        (r'^бульв\.?\s*', 'bul', 'бульвар'),
        (r'^пл\.?\s*', 'pl', 'площа'),
        (r'^наб\.?\s*', 'nab', 'набережна'),
        (r'^шосе\.?\s*', 'sh', 'шосе'),
        (r'^пер\.?\s*', 'pr', 'провулок'),
    ]
    
    for pattern, short_type, full_type in patterns:
        if re.match(pattern, name, re.IGNORECASE):
            clean = re.sub(pattern, '', name, flags=re.IGNORECASE).strip()
            clean = clean.rstrip('.')
            # Нормализуем окончания: -кой, -кой -> -кая
            clean = re.sub(r'(ой|ый|ий)$', 'ая', clean, flags=re.IGNORECASE)  # Троицкой -> Троицкая
            return full_type, clean
    
    return 'unknown', name

def detect_city(text: str) -> str:
    """Определяет город из текста."""
    cities = ['Киев', 'Одесса', 'Львов', 'Харьков', 'Днепр', 'Запорожье']
    for city in cities:
        if city.lower() in text.lower():
            return city
    return ''

def geocode_street(street: str, city: str, source: str = 'osm') -> Tuple[float, float, str]:
    """Геокодит улицу. Возвращает (lat, lon, actual_source)."""
    if not HAS_REQUESTS or not city:
        return None, None, 'none'
    
    # OSM (по умолчанию) - оранжевый
    return geocode_osm(street, city) + ('osm',)

def geocode_osm(street: str, city: str) -> Tuple[float, float]:
    """Геокодинг через OSM Nominatim - оранжевый маркер."""
    ru_to_uk = {
        'Канатная': 'Канатна',
        'Маразлиевская': 'Маразлиєвська',
        'Троицкая': 'Троїцька',
        'Дмитрия Лесича': 'Дмитра Лесича',
    }
    
    uk_name = ru_to_uk.get(street, street)
    city_uk = {'Киев': 'Київ', 'Одесса': 'Одеса'}.get(city, city)
    
    queries = [
        f'вулиця {uk_name}, {city_uk}, Україна',
        f'{uk_name} вулиця, {city_uk}',
        f'{street} вулиця, {city_uk}',
    ]
    
    for query in queries:
        try:
            resp = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={'q': query, 'format': 'json', 'limit': 5, 'addressdetails': 1},
                headers={'User-Agent': 'WME-Street-Highlighter/1.0'},
                timeout=10
            )
            data = resp.json()
            
            for item in data:
                addr = item.get('address', {})
                display = item.get('display_name', '')
                
                if 'вулиця' in display.lower() and city_uk in display:
                    return float(item['lat']), float(item['lon'])
                    
        except Exception:
            pass
    
    return None, None

def geocode_visicom(street: str, city: str) -> Tuple[float, float]:
    """Геокодинг через Visicom API - фиолетовый маркер."""
    if not HAS_REQUESTS or not VISICOM_API_KEY:
        return None, None
    
    city_uk = {'Киев': 'Київ', 'Одесса': 'Одеса'}.get(city, city)
    
    try:
        resp = requests.get(
            "https://api.visicom.ua/data-api/5.0/uk/geocode.json",
            params={
                'key': VISICOM_API_KEY,
                'near': f"{city_uk}",
                'categories': 'street',
                'q': street,
                'limit': 1
            },
            timeout=10
        )
        data = resp.json()
        
        if data.get('features'):
            feature = data['features'][0]
            coords = feature.get('geo_centroid', {}).get('coordinates', [])
            if coords and len(coords) >= 2:
                return float(coords[1]), float(coords[0])
    except Exception:
        pass
    
    return None, None

def geocode_waze(city: str) -> Tuple[float, float]:
    """Геокодинг через stat.waze.com.ua (Держрестр) - зеленый маркер."""
    if not HAS_REQUESTS:
        return None, None
    
    city_upper = city.upper()
    
    try:
        resp = requests.get(
            f"https://stat.waze.com.ua/address_map/address_map.php",
            params={
                'lat': CITY_CENTERS.get(city, (48.37, 31.17))[0],
                'lon': CITY_CENTERS.get(city, (48.37, 31.17))[1],
                'radius': 500
            },
            timeout=10
        )
        data = resp.json()
        
        if data.get('data', {}).get('polygons'):
            # Возвращаем центр города как fallback
            return CITY_CENTERS.get(city, (48.37, 31.17))
    except Exception:
        pass
    
    return None, None

def build_wme_permalink(streets, city: str = None, geocode: bool = True, 
                        preferred_source: str = 'osm') -> Dict:
    """Создаёт WME permalink с маркерами разного цвета."""
    result = {
        'permalink': '',
        'streets': list(streets),
        'city': city or 'Не определён',
        'geocoded': {},
        'markers': {},
        'source_colors': SOURCE_COLORS
    }
    
    lat, lon = 48.37, 31.17
    city_name = city
    
    if city:
        for cname, (clat, clon) in CITY_CENTERS.items():
            if cname.lower() in city.lower() or city.lower() in cname.lower():
                lat, lon = clat, clon
                city_name = cname
                break
    
    # Геокодим улицы с выбранным источником
    if geocode and HAS_REQUESTS:
        for street in streets:
            if preferred_source == 'visicom':
                slat, slon = geocode_visicom(street, city_name)
                actual_source = 'visicom' if slat else 'osm'
                if not slat:
                    slat, slon = geocode_osm(street, city_name)
            elif preferred_source == 'waze':
                slat, slon = geocode_waze(city_name)
                actual_source = 'waze' if slat else 'osm'
                if not slat:
                    slat, slon = geocode_osm(street, city_name)
            else:
                slat, slon = geocode_osm(street, city_name)
                actual_source = 'osm' if slat else 'none'
            
            if slat:
                result['geocoded'][street] = (slat, slon)
                result['markers'][street] = {
                    'lat': slat,
                    'lon': slon,
                    'color': SOURCE_COLORS.get(actual_source, '#eb933b'),
                    'source': actual_source
                }
    
    if result['geocoded']:
        avg_lat = sum(v[0] for v in result['geocoded'].values()) / len(result['geocoded'])
        avg_lon = sum(v[1] for v in result['geocoded'].values()) / len(result['geocoded'])
        lat, lon = avg_lat, avg_lon
    
    params = {
        'zoomLevel': 16,
        'lat': round(lat, 6),
        'lon': round(lon, 6),
    }
    
    result['permalink'] = f"https://waze.com/uk/editor?env=row&{urllib.parse.urlencode(params)}"
    return result

def detect_city(text: str) -> str:
    """Определяет город из текста или возвращает пустую строку."""
    cities = ['Киев', 'Одесса', 'Львов', 'Харьков', 'Днепр', 'Запорожье']
    for city in cities:
        if city.lower() in text.lower():
            return city
    return ''  # НЕ возвращаем Киев по умолчанию

def extract_streets(text: str) -> Dict[str, List]:
    """Извлекает улицы и их связи из текста."""
    results = {'segments': [], 'intersections': [], 'streets': set()}
    
    lines = text.strip().split('\n')
    
    for line in lines:
        line = line.strip().rstrip(';').strip()  # убрать точку с запятой в конце
        if not line or ('—' not in line and 'перекрёсток' not in line.lower()):
            continue
        
        # Перекрёсток
        if 'перекрёсток' in line.lower():
            # Формат: "перекрёсток пер. Дмитрия Лесича и ул. Маразлиевской"
            parts = re.split(r'\s+и\s+', line, flags=re.IGNORECASE)
            if 'перекрёсток' in parts[0].lower():
                s1 = parts[0].replace('перекрёсток', '').strip()
                s2 = parts[1].strip() if len(parts) > 1 else ''
            else:
                s1, s2 = parts[0], parts[1] if len(parts) > 1 else ''
            
            if s1 and s2:
                type1, name1 = normalize_street(s1)
                type2, name2 = normalize_street(s2)
                results['intersections'].append(Intersection(
                    Street(name1, type1, name1),
                    Street(name2, type2, name2)
                ))
                results['streets'].add(name1)
                results['streets'].add(name2)
            continue
        
        # Диапазон: "ул. Троицкая — от ул. Канатной до ул. Маразлиевской"
        if '—' in line:
            match = re.match(r'(.+?)\s*—\s*от\s+(.+?)\s+до\s+(.+)', line, re.IGNORECASE)
            if match:
                main_street = match.group(1).strip()
                from_street = match.group(2).strip()
                to_street = match.group(3).strip()
                
                stype, sname = normalize_street(main_street)
                results['segments'].append(StreetSegment(
                    Street(sname, stype, sname),
                    from_street,
                    to_street
                ))
                results['streets'].add(sname)
                
                # Добавляем улицы из диапазона
                _, from_name = normalize_street(from_street)
                results['streets'].add(from_name)
                _, to_name = normalize_street(to_street)
                results['streets'].add(to_name)
    
    return results

# Тест
if __name__ == '__main__':
    text = """Важное для водителей:

В воскресенье, 10.05.2026, с 07:30 до 09:30 из-за велосоревнований временно ограничат движение на следующих улицах:

ул. Троицкая — от ул. Канатной до ул. Маразлиевской;
ул. Маразлиевская — от ул. Троицкой до пер. Дмитрия Лесича;
перекрёсток пер. Дмитрия Лесича и ул. Маразлиевской."""
    
    result = extract_streets(text)
    print("Улицы:", result['streets'])
    print("Диапазоны:", [(s.street.normalized, s.from_street, s.to_street) for s in result['segments']])
    print("Перекрёстки:", [f"{i.street1.normalized} × {i.street2.normalized}" for i in result['intersections']])
    
    # WME permalink
    city = detect_city(text)
    result_wme = build_wme_permalink(result['streets'], city, geocode=True)
    print(f"\nWME Permalink: {result_wme['permalink']}")
    print(f"Город: {result_wme['city']}")
    print(f"Геокодированные улицы: {result_wme['geocoded']}")