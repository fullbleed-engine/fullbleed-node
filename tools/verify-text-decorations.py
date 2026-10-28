#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check saved decoration geometry and pixels independently of the Node engine."""
from argparse import ArgumentParser
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

from PIL import Image
import pypdfium2 as pdfium
from decoration_inspection import check_image, glyph_geometry

parser = ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path, nargs='?', default=Path('output/text-decorations'))
parser.add_argument('--negative-control', action='store_true')
parser.add_argument('--browser', action='store_true')
parser.add_argument('--baseline', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
source_bytes = (repo / 'test/fixtures/text-decorations-2.5.40.json').read_bytes()
oracle_bytes = (repo / 'test/fixtures/text-decoration-expectations-2.5.40.json').read_bytes()
source, oracle = json.loads(source_bytes), json.loads(oracle_bytes)
source_sha, oracle_sha = sha256(source_bytes).hexdigest(), sha256(oracle_bytes).hexdigest()
assert oracle['inputSha256'] == source_sha and oracle['fontSha256'] == source['fontSha256']
fixtures = {row['name']: row for row in source['cases']}
expected = {row['name']: row for row in oracle['cases']}
assert fixtures.keys() == expected.keys() and len(fixtures) == 16
if args.browser:
    assert not args.negative_control and args.baseline is None
    browser = json.loads((args.root / 'verification.json').read_text(encoding='utf-8'))
    prepared = json.loads((args.root.parent / 'browser-verification/prepared.json').read_text(encoding='utf-8'))
    assert browser['ok'] and browser['package'] == prepared['package'] and browser['engine'] == prepared['engine']
    assert browser['installedTarballSha256'] == prepared['installedTarballSha256']
    assert prepared['textDecorationsSourceSha256'] == source_sha
    assert prepared['textDecorationsExpectationsSha256'] == oracle_sha
    renders = dict(packageVersion=prepared['package'], engineVersion=prepared['engine'],
        tarballSha256=prepared['installedTarballSha256'], platform=browser['browserEngine'], cases=[])
    for name in fixtures:
        reference = prepared['baselines']['text-decorations-' + name]
        assert reference['pages'] == 1 and reference['missingGlyphs'] == 0 and len(reference['previews']) == 1
        renders['cases'].append(dict(name=name, isolation='browser', file='text-decorations-' + name + '.pdf',
            pdfSha256=reference['pdf'], previewSha256=reference['previews'][0]))
else:
    renders = json.loads((args.root / 'renders.json').read_text(encoding='utf-8'))
    artifact_source = (args.root / 'inputs.json').read_bytes()
    assert renders['sourceSha256'] == sha256(artifact_source).hexdigest()
    # The retained Windows control predates the repository's LF normalization.
    # Bind its original bytes first, then permit only that line-ending change.
    assert artifact_source.replace(b'\r\n', b'\n') == source_bytes
    assert renders['fontSha256'] == source['fontSha256']
if args.negative_control:
    assert renders['packageVersion'] == '0.8.3' and renders['engineVersion'] == '2.5.38'
else:
    assert renders['engineVersion'] == oracle['engineVersion'] == '2.5.40'
    assert re.fullmatch(r'[a-f0-9]{64}', renders['tarballSha256'])
modes = {'browser'} if args.browser else {'worker', 'process'}
assert len(renders['cases']) == len(fixtures) * len(modes)
assert {(r['name'], r['isolation']) for r in renders['cases']} == {(name, mode) for name in fixtures for mode in modes}
rows = []
for entry in renders['cases']:
    case, wanted = fixtures[entry['name']], expected[entry['name']]
    pdf_path = args.root / entry['file'] if args.browser else args.root / entry['directory'] / 'document.pdf'
    preview_path = args.root / ('text-decorations-' + entry['name'] + '-1.png') if args.browser else pdf_path.parent / 'preview.png'
    pdf = pdf_path.read_bytes()
    assert sha256(pdf).hexdigest() == entry['pdfSha256'] and sha256(preview_path.read_bytes()).hexdigest() == entry['previewSha256']
    geometry = json.loads(json.dumps(glyph_geometry(pdf)))
    assert geometry == wanted['geometry'], (entry['name'], 'glyph geometry differs')
    if not args.browser:
        assert entry['deterministic'] and entry['pages'] == 1
        assert (pdf_path.parent / 'input.html').read_text(encoding='utf-8') == case['html']
        assert (pdf_path.parent / 'style.css').read_text(encoding='utf-8') == case['css']
        assert geometry == json.loads(json.dumps(glyph_geometry((pdf_path.parent / 'undecorated.pdf').read_bytes())))
    row = dict(name=entry['name'], isolation=entry['isolation'], glyph_geometry_matches=True,
        pdf_sha256=entry['pdfSha256'], preview_sha256=entry['previewSha256'], images={}, errors=[])
    with pdfium.PdfDocument(pdf) as document:
        assert len(document) == 1
        page = document[0]
        bitmap = page.render(scale=2)
        image = bitmap.to_pil()
        image.save(pdf_path.with_name(pdf_path.stem + '-pdfium.png'))
        try:
            checked = check_image(image, case)
            assert checked == wanted['pdfium'], 'PDFium pixels differ from verified public core'
            row['images']['pdfium'] = checked
        except AssertionError as error:
            row['errors'].append(dict(image='pdfium', error=str(error)))
        finally:
            image.close(); bitmap.close(); page.close()
    with Image.open(preview_path) as image:
        try:
            checked = check_image(image, case)
            assert checked == wanted['native'], 'Finalized native preview differs from verified public core'
            row['images']['native'] = checked
        except AssertionError as error:
            row['errors'].append(dict(image='native', error=str(error)))
    row['passed'] = not row['errors']
    rows.append(row)
failed = [row for row in rows if not row['passed']]
failed_names = sorted({row['name'] for row in failed})
if args.negative_control:
    required = {name for name, row in expected.items() if row['previousEngineFails']}
    assert len(required) == 13
    calibrated = all({row['name'] for row in failed if row['isolation'] == mode} == required for mode in modes)
else:
    calibrated = not failed
preserved = []
if args.baseline:
    baseline = json.loads((args.baseline / 'verification.json').read_text(encoding='utf-8'))
    assert baseline['ok'] and baseline['negative_control'] and baseline['source_sha256'] == source_sha
    assert baseline['expectations_sha256'] == oracle_sha
    for row in rows:
        if expected[row['name']]['previousEngineFails']:
            continue
        previous = next(old for old in baseline['cases'] if old['name'] == row['name'] and old['isolation'] == row['isolation'])
        assert previous['passed']
        for key in ['pdf_sha256', 'preview_sha256', 'images']:
            assert row[key] == previous[key], (row['name'], key, 'healthy control changed')
        preserved.append(dict(name=row['name'], isolation=row['isolation']))
record = dict(ok=calibrated, at=datetime.now(timezone.utc).isoformat(), package_version=renders['packageVersion'],
    engine_version=renders['engineVersion'], platform=renders['platform'], tarball_sha256=renders.get('tarballSha256'),
    source_sha256=source_sha, expectations_sha256=oracle_sha, negative_control=args.negative_control,
    passed=len(rows) - len(failed), failed=len(failed), cases=rows, case_names=sorted(fixtures), failed_case_names=failed_names,
    glyph_geometry_cases=sum(row['glyph_geometry_matches'] for row in rows),
    unchanged_controls=len(preserved), preserved_controls=preserved,
    scope='Fixed-font decoration cases only. Glyph geometry and PDFium/native pixels are checked against the verified public core. This does not establish complete CSS support or general parity.')
name = 'text-decorations-verification.json' if args.browser else 'verification.json'
(args.root / name).write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: record[key] for key in ['ok', 'package_version', 'engine_version', 'platform', 'negative_control', 'passed', 'failed', 'unchanged_controls']}))
raise SystemExit(0 if calibrated else 1)
