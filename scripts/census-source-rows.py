"""Extract the two public Census tabular inputs for build-discovery-catalog.cjs.

No network calls, workbook edits or dependencies beyond Python's standard library.
Usage: python3 scripts/census-source-rows.py metros input.xlsx output.json
       python3 scripts/census-source-rows.py places geoinfo2025.csv output.json
"""
import csv
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


def metro_rows(path):
    namespace = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as archive:
        strings = ET.fromstring(archive.read('xl/sharedStrings.xml'))
        shared = [''.join(node.itertext()) for node in strings.findall('s:si', namespace)]
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        result = []
        for row in sheet.findall('s:sheetData/s:row', namespace):
            index = int(row.attrib['r']) - 1
            while len(result) <= index:
                result.append([None] * 12)
            for cell in row.findall('s:c', namespace):
                letters = re.match(r'[A-Z]+', cell.attrib['r']).group()
                column = 0
                for letter in letters:
                    column = column * 26 + ord(letter) - ord('A') + 1
                if column > 12:
                    continue
                value = cell.find('s:v', namespace)
                if value is not None:
                    result[index][column - 1] = shared[int(value.text)] if cell.attrib.get('t') == 's' else value.text
        if result[2][0] != 'CBSA Code' or result[2][9] != 'FIPS State Code':
            raise ValueError('Unexpected Census delineation workbook layout')
        return result


def place_counties(path):
    rows, pairs = [], set()
    with open(path, encoding='utf-8-sig', newline='') as source:
        for row in csv.DictReader(source, delimiter='|'):
            if (row['SUMLEVEL'], row['GEOCOMP'], row['GEOVARIANT']) != ('155', '00', '00'):
                continue
            geoid, county = row['STATE'] + row['PLACE'], row['STATE'] + row['COUNTY']
            pair = (geoid, county)
            if pair in pairs:
                raise ValueError('Duplicate county portion')
            pairs.add(pair)
            rows.append({'GEOID': geoid, 'countyFips': county, 'areaLand': int(row['AREALAND']),
                         'latitude': float(row['INTPTLAT']), 'longitude': float(row['INTPTLON']), 'name': row['NAME']})
    if len(rows) < 30000:
        raise ValueError('Incomplete place-county data')
    with open(path, 'rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    return {'metadata': {'sourceUrl': 'https://www2.census.gov/programs-surveys/geoinfo/2025/geoinfo2025.csv',
                         'sourceSha256': digest, 'sourceBytes': __import__('os').path.getsize(path),
                         'vintage': 2025, 'sumLevel': '155', 'geographicComponent': '00', 'geographicVariant': '00',
                         'rowCount': len(rows), 'placeCount': len({row['GEOID'] for row in rows})}, 'rows': rows}


if __name__ == '__main__':
    mode, input_path, output_path = sys.argv[1:]
    if mode not in ('metros', 'places'):
        raise ValueError('Expected metros or places')
    data = metro_rows(input_path) if mode == 'metros' else place_counties(input_path)
    with open(output_path, 'w', encoding='utf-8') as output:
        json.dump(data, output, separators=(',', ':'), ensure_ascii=False)
    print(json.dumps({'mode': mode, 'rows': len(data) if isinstance(data, list) else len(data['rows'])}))
