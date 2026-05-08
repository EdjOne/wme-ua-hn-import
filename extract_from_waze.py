#!/usr/bin/env python3
"""
Extract address points from stat.waze.com.ua polygons.
Source: Ukrainian State Register of Addresses.
"""
import requests
import json
import sys

def get_polygons(lat, lon, radius=500):
    """Fetch polygons around a point."""
    url = f"https://stat.waze.com.ua/address_map/address_map.php?lat={lat}&lon={lon}&radius={radius}"
    r = requests.get(url, timeout=15)
    return r.json()

def parse_polygon(item):
    """Extract point and address from polygon."""
    center = item['center'].split(';')
    lat, lon = float(center[0]), float(center[1])
    
    name_parts = item['name'].strip().split('\n')
    name_parts = [p.strip() for p in name_parts if p.strip()]
    
    city = name_parts[0].replace('м.', '').strip() if name_parts else ''
    district = name_parts[1].replace('р-н', '').strip() if len(name_parts) > 1 else ''
    street = name_parts[2].replace('вул.', '').strip() if len(name_parts) > 2 else ''
    housenumber = name_parts[3] if len(name_parts) > 3 else ''
    
    return {
        'lat': lat,
        'lon': lon,
        'city': city,
        'district': district,
        'street': street,
        'housenumber': housenumber
    }

def main():
    lat, lon = float(sys.argv[1]), float(sys.argv[2])
    radius = int(sys.argv[3]) if len(sys.argv) > 3 else 500
    
    data = get_polygons(lat, lon, radius)
    
    for item in data.get('data', {}).get('polygons', {}).get('Default', []):
        point = parse_polygon(item)
        # CSV format: housenumber,street,city,lat,lon
        print(f"{point['housenumber']},{point['street']},{point['city']},{point['lat']},{point['lon']}")

if __name__ == '__main__':
    main()