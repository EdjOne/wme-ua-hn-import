#!/usr/bin/env python3
"""Test geocoding methods."""

import requests

def test_overpass():
    """Ищет улицы через Overpass в Киеве."""
    query = """
    [out:json][timeout:5];
    area[name="Kyiv"]->.searchArea;
    (
      way["name"="Троицкая"](area.searchArea);
      way["name"="Канатная"](area.searchArea);
      way["name"="Маразлиевская"](area.searchArea);
    );
    out center;
    """
    url = "https://overpass-api.de/api/interpreter"
    resp = requests.post(url, data=query.encode('utf-8'), headers={'Content-Type': 'application/x-www-form-urlencoded'})
    data = resp.json()
    
    for elem in data.get('elements', []):
        center = elem.get('center', {})
        print(f"{elem.get('tags', {}).get('name')}: {center.get('lat')}, {center.get('lon')}")

def test_nominatim_detailed():
    """Подробный поиск через Nominatim."""
    streets = ['Троицкая', 'Канатная', 'Маразлиевская', 'Дмитрия Лесича']
    
    for street in streets:
        queries = [
            f"улица {street}, Киев, Украина",
            f"{street} улица, Киев",
        ]
        for q in queries:
            resp = requests.get('https://nominatim.openstreetmap.org/search', 
                params={'q': q, 'format': 'json', 'limit': 5},
                headers={'User-Agent': 'test'})
            data = resp.json()
            for item in data[:3]:
                print(f"{street} | {q}")
                print(f"  → {item.get('display_name')}")
                print(f"  → lat={item.get('lat')}, lon={item.get('lon')}")
                print(f"  → class={item.get('class')}")
            break

if __name__ == '__main__':
    print("=== Nominatim ===")
    test_nominatim_detailed()