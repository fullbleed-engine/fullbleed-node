# SPDX-License-Identifier: MIT
"""Read saved counter PDFs independently, retaining the public failure control."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re

from PIL import Image
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'test/fixtures/generated-counters-2.5.49.json'
MODES = ('direct', 'fixed', 'reflow')


def normalize(text):
    return re.sub(r'\s+', '', text)


def verify(directory, *, negative_control=False, baseline=None):
    directory = Path(directory)
    source_bytes = SOURCE.read_bytes()
    source = json.loads(source_bytes)
    fixture_sha = sha256(source_bytes).hexdigest()
    report = json.loads((directory / 'renders.json').read_bytes())
    assert report['status'] == 'rendered-awaiting-independent-readback'
    assert report['fixtureSha256'] == fixture_sha and (directory / 'inputs.json').read_bytes() == source_bytes
    assert report['isolation'] == 'process' and report['defaultStyles'] is False
    if negative_control:
        assert report['packageVersion'] == '0.9.1' and report['engineVersion'] == '2.5.48'
    else:
        assert report['engineVersion'] == source['engineVersion'] == '2.5.49'
    modes = ('direct',) if negative_control else MODES
    assert tuple(report['modes']) == modes
    expected = {row['name']:row for row in source['cases']}
    wanted = {(name, mode) for name in expected for mode in modes}
    assert len(expected) == 59 and len(report['cases']) == len(wanted)
    assert {(r['name'],r['mode']) for r in report['cases']} == wanted
    records = []
    for row in report['cases']:
        name, mode = row['name'], row['mode']
        names = ['Ada'] if mode == 'direct' else ['Ada', 'Bea']
        assert row['names'] == names and row['filename'] == name+'-'+mode+'.pdf' and row['missingGlyphs'] == 0
        path = directory / row['filename']
        assert sha256(path.read_bytes()).hexdigest() == row['pdfSha256']
        reader = PdfReader(path, strict=True)
        assert len(reader.pages) == row['pages'] == expected[name]['pagesPerRecord'] * len(names)
        actual = normalize(''.join(page.extract_text() or '' for page in reader.pages))
        text = ''.join('Record'+value+expected[name]['expectedCounterText'] for value in names)
        with pdfium.PdfDocument(path) as document:
            assert len(document) == len(reader.pages)
            independent = []
            for number in range(len(document)):
                page = document[number]
                try:
                    text_page = page.get_textpage()
                    try:
                        independent.append(text_page.get_text_range())
                    finally:
                        text_page.close()
                    if name == 'block-after-increment':
                        bitmap = page.render(scale=96/72)
                        try:
                            bitmap.to_pil().save(directory / f'{name}-{mode}-pdfium-{number+1}.png')
                        finally:
                            bitmap.close()
                finally:
                    page.close()
            assert normalize(''.join(independent)) == actual, (name,mode,'PDF readers disagree')
        previews = row['previews']
        assert len(previews) == (row['pages'] if name == 'block-after-increment' else 0)
        for number, preview in enumerate(previews, 1):
            assert preview['filename'] == f'{name}-{mode}-native-{number}.png'
            image_path = directory / preview['filename']
            assert sha256(image_path.read_bytes()).hexdigest() == preview['sha256']
            with Image.open(image_path) as image:
                assert min(image.convert('L').getextrema()) < 200
        records.append(dict(name=name, mode=mode, pages=row['pages'], pdfSha256=row['pdfSha256'],
            actual=actual, expected=text, matchesExpected=actual == text, independentReadersAgree=True,
            previews=previews))
    failures = [r['name']+'-'+r['mode'] for r in records if not r['matchesExpected']]
    result = dict(ok=not failures, negativeControl=negative_control, packageVersion=report['packageVersion'],
        engineVersion=report['engineVersion'], platform=report['platform'], node=report['node'],
        isolation=report['isolation'], defaultStyles=report['defaultStyles'],
        fixtureSha256=fixture_sha, wasmSha256=report['wasmSha256'], documents=len(records),
        pages=sum(r['pages'] for r in records), failures=failures, cases=records,
        scope='59 reviewed core counter documents through direct and compiled fixed/reflow saved-PDF paths. '
        'Exact text and page counts are read with pypdf and PDFium. HTML list controls preserve Fullbleed behavior; '
        'this is not complete CSS or browser raster parity.')
    if negative_control:
        result['ok'] = len(failures) == 47 and len(records)-len(failures) == 12
    elif baseline is not None:
        before = json.loads((Path(baseline) / 'verification.json').read_bytes())
        assert before['ok'] and before['negativeControl'] and before['packageVersion'] == '0.9.1'
        assert before['fixtureSha256'] == fixture_sha and len(before['cases']) == 59 and len(before['failures']) == 47
        direct = {r['name']:r for r in records if r['mode'] == 'direct'}
        healthy = [r for r in before['cases'] if r['matchesExpected']]
        assert all((direct[r['name']]['actual'],direct[r['name']]['pages']) == (r['actual'],r['pages']) for r in healthy)
        result['publicControl'] = dict(packageVersion='0.9.1', engineVersion='2.5.48',
            correctedDirectCases=sum(not r['matchesExpected'] and direct[r['name']]['matchesExpected'] for r in before['cases']),
            unchangedHealthyControls=len(healthy), reportSha256=sha256((Path(baseline)/'verification.json').read_bytes()).hexdigest())
        assert result['publicControl']['correctedDirectCases'] == 47 and len(healthy) == 12
    (directory / 'verification.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8')
    assert result['ok'], 'Counter readback failed; inspect verification.json'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=ROOT / 'output/generated-counters')
    parser.add_argument('--negative-control', action='store_true')
    parser.add_argument('--baseline', type=Path)
    args = parser.parse_args()
    result = verify(args.directory, negative_control=args.negative_control, baseline=args.baseline)
    print(json.dumps({k:result[k] for k in ['ok','negativeControl','packageVersion','engineVersion','documents','pages','failures']}))
