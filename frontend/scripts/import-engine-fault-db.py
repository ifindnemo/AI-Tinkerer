"""Extract auditable raw values; never infer units or decode Fault labels."""
import collections
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

source = Path(sys.argv[1])
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(source) as archive:
    strings = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        strings = [''.join(t.text or '' for t in node.findall('.//m:t', ns))
                   for node in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
    rows = ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row', ns)
    def values(row):
        result = []
        for cell in row:
            node = cell.find('m:v', ns)
            value = node.text if node is not None else ''.join(cell.itertext())
            if cell.get('t') == 's':
                value = strings[int(value)]
            result.append(value)
        return result
    headers = values(rows[0])
    counts = collections.Counter()
    samples = collections.defaultdict(list)
    limits = {header: [float('inf'), float('-inf')] for header in headers}
    for row in rows[1:]:
        vals = values(row)
        if len(vals) != len(headers):
            raise ValueError(f'Incomplete row {row.attrib["r"]}; inspect source before import')
        data = dict(zip(headers, map(float, vals)))
        label = str(int(data['Fault'])) if data['Fault'].is_integer() else str(data['Fault'])
        counts[label] += 1
        if len(samples[label]) < 3:
            samples[label].append({'row': int(row.attrib['r']), 'values': data})
        for header, number in data.items():
            limits[header][0] = min(limits[header][0], number)
            limits[header][1] = max(limits[header][1], number)
    output = {
        'filename': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'sheet': 'EngineFaultDB_Final', 'rowCount': len(rows) - 1, 'headers': headers,
        'ranges': limits,
        'classes': [{'code': code, 'count': count, 'samples': samples[code]} for code, count in sorted(counts.items())],
        'interpretation': 'Raw values only. No units, scale corrections, fault-name mapping, or diagnostic predictions inferred.'
    }
    target = Path(__file__).resolve().parents[1] / 'src/data/engine-fault-db.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'rowCount': output['rowCount'], 'counts': counts, 'ranges': limits}, indent=2))
