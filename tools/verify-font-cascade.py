# SPDX-License-Identifier: MIT
"""Check the text operators' actual fonts rather than unused PDF resources."""
import argparse
from hashlib import sha256
from importlib.metadata import version
import json
from pathlib import Path
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'test/fixtures/font-cascade-2.5.51.json'

def verify(directory, negative_control=False):
    directory = Path(directory)
    source_bytes = SOURCE.read_bytes()
    source = json.loads(source_bytes)
    report = json.loads((directory / 'renders.json').read_bytes())
    assert report['status'] == 'rendered-awaiting-independent-readback'
    assert report['fixtureSha256'] == sha256(source_bytes).hexdigest()
    assert (directory / 'inputs.json').read_bytes() == source_bytes
    assert report['isolation'] == 'process' and report['defaultStyles'] is False
    if negative_control:
        assert report['packageVersion'] == source['negativeControl']['packageVersion'] == '0.9.3'
        assert report['engineVersion'] == source['negativeControl']['engineVersion'] == '2.5.50'
    else:
        assert report['engineVersion'] == source['engineVersion'] == '2.5.51'
    expected = {case['name']: case for case in source['cases']}
    assert len(expected) == len(report['cases']) == 13
    assert {case['name'] for case in report['cases']} == expected.keys()
    cases = []
    for row in report['cases']:
        name = row['name']
        assert row['filename'] == name + '.pdf' and row['missingGlyphs'] == 0
        path = directory / row['filename']
        assert sha256(path.read_bytes()).hexdigest() == row['pdfSha256']
        reader = PdfReader(path, strict=True)
        assert len(reader.pages) == row['pages'] == expected[name]['pages'] == 1
        page = reader.pages[0]
        assert ' '.join(page.extract_text().split()) == 'Font witness'
        stream = ContentStream(page.get_contents(), reader)
        used = {str(args[0]) for args, operator in stream.operations if operator == b'Tf'}
        mapping = page['/Resources']['/Font']
        actual = sorted({str(mapping[key].get_object()['/BaseFont']).removeprefix('/') for key in used})
        assert actual
        assert len(row['previews']) == 1
        preview = row['previews'][0]
        assert preview['filename'] == name + '-1.png'
        image_path = directory / preview['filename']
        assert sha256(image_path.read_bytes()).hexdigest() == preview['sha256']
        with Image.open(image_path) as image:
            assert min(image.convert('L').getextrema()) < 200
        cases.append({**row, 'actualBaseFonts': actual, 'expectedBaseFonts': expected[name]['expectedBaseFonts'],
                      'matchesExpected': actual == expected[name]['expectedBaseFonts']})
    failed = sorted(case['name'] for case in cases if not case['matchesExpected'])
    if negative_control:
        assert {case['name']: case['actualBaseFonts'] for case in cases} == source['negativeControl']['actualBaseFonts']
        assert len(failed) == 11
    else:
        assert not failed, failed
    result = {**{key: value for key, value in report.items() if key not in ['status', 'cases']},
        'ok': True, 'negativeControl': negative_control, 'reader': 'pypdf ' + version('pypdf'),
        'documents': len(cases), 'failures': failed, 'cases': cases,
        'scope': source['scope']}
    (directory / 'verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=ROOT / 'output/font-cascade')
    parser.add_argument('--negative-control', action='store_true')
    args = parser.parse_args()
    result = verify(args.directory, args.negative_control)
    print(json.dumps({key: result[key] for key in ['ok', 'negativeControl', 'packageVersion', 'engineVersion', 'documents', 'failures']}))
