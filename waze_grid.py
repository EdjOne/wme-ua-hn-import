#!/usr/bin/env python3
"""
Mass extract address points from stat.waze.com.ua polygons.
Grid-based collection for large areas.
"""
import requests
import json
import sys
import time

def get_polygons(lat, lon, radius=500):
    url = f"https://stat.waze.com.ua/address_map/address_map.php?lat={lat}&lon={lon}&radius={radius}"
    r = requests.get(url, timeout=15)
    return r.json()

def parse_polygon(item):
    center = item['center'].split(';')
    lat, lon = float(center[0]), float(center[1])
    name_parts = item['name'].strip().split('\n')
    name_parts = [p.strip() for p in name_parts if p.strip()]
    city = name_parts[0].replace('м.', '').strip() if name_parts else ''
    district = name_parts[1].replace('р-н', '').strip() if len(name_parts) > 1 else ''
    street = name_parts[2].replace('вул.', '').strip() if len(name_parts) > 2 else ''
    housenumber = name_parts[3] if len(name_parts) > 3 else ''
    return {'lat': lat, 'lon': lon, 'city': city, 'district': district, 'street': street, 'housenumber': housenumber}

def grid_walk(min_lat, max_lat, min_lon, max_lon, step=0.005, radius=500):
    """Walk grid collecting addresses."""
    seen = set()
    lat = min_lat
    while lat <= max_lat:
        lon = min_lon
        while lon <= max_lon:
            try:
                data = get_polygons(lat, lon, radius)
                for item in data.get('data', {}).get('polygons', {}).get('Default', []):
                    point = parse_polygon(item)
                    key = f"{point['housenumber']},{point['street']},{point['city']}"
                    if key not in seen:
                        seen.add(key)
                        print(f"{point['housenumber']},{point['street']},{point['city']},{point['lat']:.6f},{point['lon']:.6f}")
            except Exception as e:
                print(f"# Error at {lat},{lon}: {e}", file=sys.stderr)
            lon += step
        lat += step
        time.sleep(0.1)  # be nice to API

if __name__ == '__main__':
    if len(sys.argv) < 5:
        print("Usage: waze_grid.py min_lat max_lat min_lon max_lon [step_km] [radius_m]")
        sys.exit(1)
    min_lat, max_lat = float(sys.argv[1]), float(sys.argv[2])
    min_lon, max_lon = float(sys.argv[3]), float(sys.argv[4])
    step = float(sys.argv[5]) / 111.0 if len(sys.argv) > 5 else 0.005
    radius = int(sys.argv[6]) if len(sys.argv) > 6 else 500
    grid_walk(min_lat, max_lat, min_lon, max_lon, step, radius)