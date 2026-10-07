#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Inspect installed-package Standard 14 previews and compare public baselines."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader
import pypdfium2 as pdfium


def verify(out, baseline=None):
    renders = json.loads((out / 'renders.json').read_text(encoding='utf-8'))
    assert renders['ok'] and len(renders['cases']) == 26
    previous = None
    if baseline is not None:
        previous = json.loads((baseline / 'renders.json').read_text(encoding='utf-8'))
        assert previous['ok'] and previous['negativeControl'] and previous['packageVersion'] == '0.3.1'
        previous = {(case['name'], case['isolation']): case for case in previous['cases']}
    records = []
    for case in renders['cases']:
        folder = out / case['directory']
        data = (folder / 'document.pdf').read_bytes()
        assert sha256(data).hexdigest() == case['pdfSha256']
        assert sha256((folder / 'preview.png').read_bytes()).hexdigest() == case['pngSha256']
        reader = PdfReader(folder / 'document.pdf')
        assert len(reader.pages) == 1
        text = ' '.join(reader.pages[0].extract_text().split())
        assert text == renders['expectedText'], (case['name'], text)
        fonts = [reference.get_object() for reference in reader.pages[0]['/Resources']['/Font'].values()]
        names = [str(font['/BaseFont']).lstrip('/') for font in fonts]
        if case['font'] == 'Inter':
            assert any('Inter' in name for name in names), names
        else:
            assert names == [case['font']], names
            assert '/FontDescriptor' not in fonts[0], 'Fixture must exercise an unembedded face'
        with pdfium.PdfDocument(data) as document:
            page = document[0]
            textpage = page.get_textpage()
            extracted = ' '.join(textpage.get_text_range().split())
            assert extracted == text, (case['name'], extracted)
            textpage.close()
            bitmap = page.render(scale=1)
            independent = bitmap.to_pil().convert('RGB')
            independent.save(folder / 'pdfium.png')
            assert ImageChops.difference(independent, Image.new('RGB', independent.size, 'white')).getbbox()
            independent.close()
            bitmap.close()
            page.close()
        with Image.open(folder / 'preview.png') as source:
            native = source.convert('RGB')
        ink = ImageChops.difference(native, Image.new('RGB', native.size, 'white')).getbbox()
        blank_expected = renders['negativeControl'] and case['font'] != 'Inter'
        assert (ink is None) == blank_expected, case['name']
        record = {'name': case['name'], 'isolation': case['isolation'], 'font': case['font'],
            'text': text, 'nativeInkBounds': ink, 'pdfSha256': case['pdfSha256'], 'pngSha256': case['pngSha256']}
        if previous is not None:
            old = previous[(case['name'], case['isolation'])]
            assert old['pdfSha256'] == case['pdfSha256'], 'Font preview update changed PDF bytes'
            if case['font'] == 'Inter':
                assert old['pngSha256'] == case['pngSha256'], 'Embedded-font control changed'
            else:
                assert old['inkPixels'] == 0 and case['inkPixels'] > 0 and old['pngSha256'] != case['pngSha256']
            record['pdfMatchesPublic031'] = True
        records.append(record)
    report = {'ok': True, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'packageVersion': renders['packageVersion'], 'engineVersion': renders['engineVersion'],
        'negativeControl': renders['negativeControl'], 'installedTarballSha256': renders['installedTarballSha256'],
        'cases': records, 'baselinePackage': '0.3.1' if previous is not None else None,
        'scope': 'Twelve unembedded Latin faces and one embedded-font control in both Node modes. Independent PDF text/font selection and visible previews; no general font-design parity or PDF conformance claim.'}
    (out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'package': report['packageVersion'], 'cases': len(records),
        'blank': sum(row['nativeInkBounds'] is None for row in records), 'baseline': report['baselinePackage']}))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path, nargs='?', default=Path('output/standard-fonts'))
    parser.add_argument('--baseline', type=Path)
    arguments = parser.parse_args()
    verify(arguments.out, arguments.baseline)
