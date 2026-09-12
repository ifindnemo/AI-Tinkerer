"""Build a small, auditable demo profile; never repair unknown Excel scales."""
import hashlib
import json
import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

source = Path(sys.argv[1])
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
# Design constraints for a combustion-engine driving demo, NOT verified units,
# manufacturer thresholds, or evidence that the retained records are correct.
fields = {
    'rpm': ('RPM', 600, 6500),
    'map': ('MAP', 0, 100),
    'tps': ('TPS', 0, 100),
    'consumption': ('Consumption L/H', 0, 30),
    'speed': ('Speed', 0, 130),
}
with zipfile.ZipFile(source) as archive:
    strings = [''.join(node.itertext()) for node in ET.fromstring(archive.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in archive.namelist() else []
    styles = ET.fromstring(archive.read('xl/styles.xml')).find('m:cellXfs', ns)
    # Workbook custom formats 164–167 are dd.mm / d.m / yyyy.mm / yyyy.m.
    date_styles = {str(i) for i, xf in enumerate(styles) if int(xf.get('numFmtId', '0')) in {*range(14, 23), 164, 165, 166, 167}}
    rows = ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row', ns)
    headers = {}
    for cell in rows[0]:
        column = ''.join(c for c in cell.attrib['r'] if c.isalpha())
        value = cell.find('m:v', ns).text
        headers[column] = strings[int(value)] if cell.get('t') == 's' else value
    raw = {name: [] for name, _, _ in fields.values()}
    accepted = {name: [] for name in raw}
    excluded_dates = {name: 0 for name in raw}
    bands = {name: (low, high) for name, low, high in fields.values()}
    for row in rows[1:]:
        for cell in row:
            name = headers.get(''.join(c for c in cell.attrib['r'] if c.isalpha()))
            if name not in raw:
                continue
            node = cell.find('m:v', ns)
            if node is None or cell.get('t') in ('e', 'b'):
                continue
            try:
                value = float(strings[int(node.text)] if cell.get('t') == 's' else node.text)
            except ValueError:
                continue
            if not math.isfinite(value):
                continue
            raw[name].append(value)
            if cell.get('s', '0') in date_styles:
                excluded_dates[name] += 1
                continue
            low, high = bands[name]
            if low <= value <= high:
                accepted[name].append(value)
    channels = {}
    for key, (name, low, high) in fields.items():
        values = sorted(accepted[name])
        if len(values) < 100:
            raise ValueError(f'Insufficient reference values for {name}')
        channels[key] = {
            'column': name, 'rawRange': [min(raw[name]), max(raw[name])],
            'demoFilter': [low, high], 'acceptedCount': len(values),
            'excludedDateCells': excluded_dates[name],
            'retainedRange': [values[0], values[-1]],
            'range': [round(values[round((len(values)-1)*q)], 2) for q in (.05, .95)],
        }
output = {
    'version': 1, 'source': source.name,
    'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'method': 'Exclude date-formatted cells and values outside explicit demo bands; use nearest-index P05–P95 of retained values. No rescaling or row replay. Units and filters are demo assumptions, not validated sensor calibration.',
    'channels': channels,
}
target = Path(__file__).resolve().parents[1] / 'src/data/telemetry-profile.json'
target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(channels, indent=2))
