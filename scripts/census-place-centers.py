"""Offline Census place internal-point/county join. No addresses or network calls.

Usage: python3 scripts/census-place-centers.py places.zip counties.zip
       place-counties2025.json output.json
Inputs are pinned public Gazetteer/TIGER/GeoInfo files, never customer data.
"""
import csv
import hashlib
import io
import json
import struct
import sys
import zipfile
from collections import defaultdict


def dbf_ids(data):
    count = struct.unpack_from('<I', data, 4)[0]
    header, width = struct.unpack_from('<HH', data, 8)
    fields, offset = {}, 1
    for pos in range(32, header - 1, 32):
        if data[pos] == 13:
            break
        name = data[pos:pos + 11].split(b'\0')[0].decode('ascii')
        size = data[pos + 16]
        fields[name] = (offset, size)
        offset += size
    start, size = fields['GEOID']
    return [data[header + row * width + start:header + row * width + start + size].decode('ascii').strip()
            for row in range(count)]


def contains(data, x, y):
    """Even-odd rings handle polygon islands and holes without ring assumptions."""
    shape = struct.unpack_from('<I', data, 0)[0]
    if shape not in (5, 15, 25):
        raise ValueError(f'Expected county Polygon, got {shape}')
    xmin, ymin, xmax, ymax = struct.unpack_from('<4d', data, 4)
    if not (xmin <= x <= xmax and ymin <= y <= ymax):
        return False
    part_count, point_count = struct.unpack_from('<2I', data, 36)
    starts = list(struct.unpack_from(f'<{part_count}I', data, 44)) + [point_count]
    origin = 44 + part_count * 4
    inside = False
    for start, end in zip(starts, starts[1:]):
        previous = struct.unpack_from('<2d', data, origin + (end - 1) * 16)
        for index in range(start, end):
            current = struct.unpack_from('<2d', data, origin + index * 16)
            ax, ay = previous
            bx, by = current
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
            previous = current
    return inside


def main():
    places_path, counties_path, crosswalk_path, output_path = sys.argv[1:]
    crosswalk = json.load(open(crosswalk_path, encoding='utf-8'))
    candidates = defaultdict(set)
    for row in crosswalk['rows']:
        candidates[row['GEOID']].add(row['countyFips'])
    points, result, pending = {}, {}, defaultdict(list)
    with zipfile.ZipFile(places_path) as archive:
        name = next(name for name in archive.namelist() if name.endswith('.txt'))
        with archive.open(name) as source:
            for row in csv.DictReader(io.TextIOWrapper(source, encoding='utf-8-sig'), delimiter='|'):
                point = (float(row['INTPTLONG']), float(row['INTPTLAT']))
                geoid = row['GEOID']
                codes = sorted(candidates[geoid])
                if len(codes) == 1:
                    result[geoid] = codes[0]
                else:
                    points[geoid] = point
                    for code in codes:
                        pending[code].append(geoid)
    hits = defaultdict(list)
    with zipfile.ZipFile(counties_path) as archive:
        dbf = next(name for name in archive.namelist() if name.endswith('.dbf'))
        shp = next(name for name in archive.namelist() if name.endswith('.shp'))
        ids = dbf_ids(archive.read(dbf))
        with archive.open(shp) as source:
            if struct.unpack_from('>I', source.read(100), 0)[0] != 9994:
                raise ValueError('Invalid shapefile header')
            for code in ids:
                record = source.read(8)
                if len(record) != 8:
                    raise ValueError('Truncated county shapefile')
                length = struct.unpack_from('>I', record, 4)[0] * 2
                data = source.read(length)
                if len(data) != length:
                    raise ValueError('Truncated county geometry')
                for geoid in pending[code]:
                    if contains(data, *points[geoid]):
                        hits[geoid].append(code)
    unresolved = []
    for geoid in points:
        matches = hits[geoid]
        if len(matches) == 1:
            result[geoid] = matches[0]
        else:
            # Never invent a center's county or silently widen an ambiguous area.
            result[geoid] = None
            unresolved.append(geoid)
    with open(counties_path, 'rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    payload = {'metadata': {'source': 'https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip',
                            'sha256': digest, 'pointSource': '2025 Gazetteer internal point',
                            'unresolved': unresolved}, 'counties': dict(sorted(result.items()))}
    with open(output_path, 'w', encoding='utf-8') as output:
        json.dump(payload, output, separators=(',', ':'))
    print(json.dumps({'resolved': sum(bool(value) for value in result.values()), 'unresolved': len(unresolved),
                      'multiCountyPointsChecked': len(points)}))


if __name__ == '__main__':
    main()
