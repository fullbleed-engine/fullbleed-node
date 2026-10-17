#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Inspect JavaScript PDFs and previews against specified SVG/shadow paint."""
from contextlib import closing
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'test/fixtures/engine-paint-2.5.28.json'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def inspect_case(case, pdf, preview, destination):
    checks = []
    def check(name, ok, **details):
        checks.append(dict(name=name, ok=bool(ok), **details))
    reader = PdfReader(pdf)
    expected = case['expected']
    check('PDF page count', len(reader.pages) == case['pages'])
    check('PDF text', [' '.join(page.extract_text().split()) for page in reader.pages] == [expected['text']])
    with closing(pdfium.PdfDocument(pdf)) as document:
        check('independent PDF page count', len(document) == 1)
        assert len(document) == 1
        with closing(document[0]) as page:
            size = list(page.get_size())
            check('physical page size', all(abs(a-b) < .01 for a, b in zip(size, expected['pageSizePt'])), actual=size)
            with closing(page.get_textpage()) as text:
                check('independent text', ' '.join(text.get_text_range().split()) == expected['text'])
                outside = []
                for index in range(text.count_chars()):
                    if not text.get_text_range(index, 1).strip():
                        continue
                    left, bottom, right, top = text.get_charbox(index)
                    if not (-1 <= left <= right <= size[0]+1 and -1 <= bottom <= top <= size[1]+1):
                        outside.append([index, left, bottom, right, top])
                check('text stays on paper', not outside, outside=outside)
            with closing(page.render(scale=case['previewDpi']/72)) as bitmap:
                independent = bitmap.to_pil().convert('RGB')
    with Image.open(preview) as image:
        native = image.convert('RGB')
    try:
        independent.save(destination / 'pdfium-1.png')
        wanted_size = [math.ceil(n * case['previewDpi'] / 72) for n in expected['pageSizePt']]
        for mode, image in [('preview', native), ('pdfium', independent)]:
            # Independent PDF rasterizers can ceil a fractional device edge.
            check(mode + ' dimensions', all(abs(a-b) <= 1 for a,b in zip(image.size, wanted_size)), actual=list(image.size))
            for probe in expected['probes']:
                x = math.floor((probe['x'] + .5) * case['previewDpi'] / 96)
                y = math.floor((probe['y'] + .5) * case['previewDpi'] / 96)
                color = list(image.getpixel((x, y)))
                check(mode + ' color', max(abs(a-b) for a,b in zip(color, probe['expected'])) <= probe['tolerance'],
                    x=x, y=y, actual=color, expected=probe['expected'], tolerance=probe['tolerance'])
    finally:
        independent.close()
        native.close()
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path, nargs='?', default=ROOT / 'output/engine-paint')
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--negative-control', action='store_true')
    args = parser.parse_args()
    assert not (args.browser and args.negative_control)
    source = json.loads(SOURCE.read_text(encoding='utf-8'))
    cases = {case['name']: case for case in source['cases']}
    assert len(cases) == len(source['cases'])
    out = args.out.resolve()
    origin = json.loads((out / ('verification.json' if args.browser else 'renders.json')).read_text(encoding='utf-8'))
    assert origin['ok']
    source_hash = digest(SOURCE)
    if args.browser:
        assert origin['enginePaintSourceSha256'] == source_hash
        downloads = {item['file']: item for item in origin['documents']}
        assert len(downloads) == len(origin['documents'])
        records = [dict(name=name, isolation='browser', directory=name, pages=case['pages']) for name,case in cases.items()]
        package, engine = origin['package'], origin['engine']
    else:
        assert origin['sourceSha256'] == source_hash
        records = origin['cases']
        assert len(records) == len(cases)*2
        assert {(row['name'], row['isolation']) for row in records} == {(name, mode) for name in cases for mode in ('worker', 'process')}
        package, engine = origin['packageVersion'], origin['engineVersion']
    if args.negative_control:
        assert (package, engine) == (source['negativeControl']['packageVersion'], source['negativeControl']['engineVersion'])
    else:
        assert engine == source['engineVersion']
    report = dict(schema='fullbleed.javascript.engine-paint.verification.v1', ok=False,
        checkedAt=datetime.now(timezone.utc).isoformat(), packageVersion=package, engineVersion=engine,
        sourceSha256=source_hash, installedTarballSha256=origin.get('installedTarballSha256'),
        wasmSha256=origin.get('wasmSha256'), negativeControl=args.negative_control, browser=args.browser,
        tools={name: version(name) for name in ('pypdf', 'pypdfium2', 'pillow')}, cases=[],
        scope='Specified colors, opacity/cascade controls, Gaussian blur probes, clear regions at 300 DPI, text and page bounds. No complete CSS/browser parity or standards claim.')
    located = {}
    try:
        for record in records:
            name, mode = record['name'], record['isolation']
            case = cases[name]
            destination = (out / record['directory']).resolve()
            assert destination.is_relative_to(out)
            destination.mkdir(exist_ok=True)
            pdf = out / (name + '.pdf') if args.browser else destination / 'document.pdf'
            preview = out / (name + '-1.png') if args.browser else destination / 'preview-1.png'
            if args.browser:
                for path in (pdf, preview):
                    receipt = downloads[path.name]
                    assert path.stat().st_size == receipt['bytes'] and digest(path) == receipt['sha256']
            else:
                assert record['repeatPdfBytesIdentical'] and record['repeatPreviewBytesIdentical']
                assert digest(pdf) == record['pdfSha256'] and [digest(preview)] == record['previewsSha256']
            try:
                checks = inspect_case(case, pdf, preview, destination)
                row = dict(name=name, family=case['family'], isolation=mode, pdfSha256=digest(pdf), checks=checks)
                row['ok'] = all(check['ok'] for check in checks)
            except Exception as error:
                row = dict(name=name, family=case['family'], isolation=mode, ok=False, error=str(error), checks=[])
            located[(name, mode)] = (preview, destination / 'pdfium-1.png', row)
            report['cases'].append(row)
        for (name, mode), (preview, independent, row) in located.items():
            region = cases[name]['expected'].get('clearRegion')
            if region is None:
                continue
            reference = located[(region['reference'], mode)]
            for index, (label, actual) in enumerate((('preview', preview), ('pdfium', independent))):
                with Image.open(actual) as a, Image.open(reference[index]) as b:
                    assert a.size == b.size
                    bounds = (region['start'], region['start'], *a.size)
                    with a.convert('RGB') as rgb_a, b.convert('RGB') as rgb_b:
                        with rgb_a.crop(bounds) as crop_a, rgb_b.crop(bounds) as crop_b:
                            with ImageChops.difference(crop_a, crop_b) as difference:
                                pixels = difference.tobytes()
                                unequal = sum(any(pixel) for pixel in zip(pixels[0::3], pixels[1::3], pixels[2::3]))
                    row['checks'].append(dict(name=label + ' complete clear region', ok=unequal == 0,
                        dpi=300, region=list(bounds), differingPixels=unequal))
            row['ok'] = all(check['ok'] for check in row['checks']) and 'error' not in row
        failed = [row for row in report['cases'] if not row['ok']]
        report['failedFamilies'] = sorted({row['family'] for row in failed})
        if args.negative_control:
            required = set(source['negativeControl']['requiredFailingFamilies'])
            controls = set(source['negativeControl']['passingControls'])
            report['ok'] = (required <= set(report['failedFamilies'])
                and not any('error' in row for row in report['cases'])
                and all(row['ok'] for row in report['cases'] if row['name'] in controls))
        else:
            report['ok'] = not failed
        report['failedCases'] = [row['isolation'] + '/' + row['name'] for row in failed]
    finally:
        filename = 'engine-paint.json' if args.browser else 'verification.json'
        (out / filename).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(ok=report['ok'], package=package, engine=engine, cases=len(report['cases']),
        negativeControl=args.negative_control, failed=len(report.get('failedCases', [])), failedFamilies=report.get('failedFamilies'))))
    assert report['ok'], 'Inspect the retained paint verification report.'


if __name__ == '__main__':
    main()
