#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check positioned words in PDFs from the installed npm package independently."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import json
from pathlib import Path
import re

from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageChops


def inspect_page(page):
    textpage = page.get_textpage()
    try:
        text = ''.join(textpage.get_text_range(i, 1) for i in range(textpage.count_chars()))
        words = []
        for match in re.finditer(r'\S+', text):
            boxes = [textpage.get_charbox(i) for i in range(match.start(), match.end())]
            words.append({'text': match.group(), 'box': [min(b[0] for b in boxes), min(b[1] for b in boxes),
                          max(b[2] for b in boxes), max(b[3] for b in boxes)]})
        return ' '.join(text.split()), words
    finally:
        textpage.close()


def verify(out):
    renders = json.loads((out / 'renders.json').read_text(encoding='utf-8'))
    assert renders['ok'] and len(renders['cases']) == 24
    expected = renders['expectedText']
    report = {'ok': False, 'checkedAt': datetime.now(timezone.utc).isoformat(),
              'packageVersion': renders['packageVersion'], 'engineVersion': renders['engineVersion'],
              'installedTarballSha256': renders['installedTarballSha256'],
              'versions': {name: version(name) for name in ['pypdf', 'pypdfium2', 'pillow']}, 'cases': []}
    try:
        for case in renders['cases']:
            folder = out / case['directory']
            result = {'name': case['name'], 'isolation': case['isolation'], 'ok': False}
            report['cases'].append(result)
            try:
                data = (folder / 'document.pdf').read_bytes()
                assert sha256(data).hexdigest() == case['pdfSha256']
                assert sha256((folder / 'preview-1.png').read_bytes()).hexdigest() == case['previewsSha256'][0]
                with Image.open(folder / 'preview-1.png') as source:
                    image = source.convert('RGB')
                    result['nativePreviewInkBounds'] = ImageChops.difference(image, Image.new('RGB', image.size, 'white')).getbbox()
                if case['name'] not in ['inline-helvetica', 'inline-times']:
                    assert result['nativePreviewInkBounds'], 'Embedded-font preview contains no ink'
                reader = PdfReader(folder / 'document.pdf')
                assert len(reader.pages) == 1
                result['pypdfText'] = ' '.join(reader.pages[0].extract_text().split())
                assert result['pypdfText'] == expected, 'pypdf text content or order differs'
                if case['name'] in ['inline-different-font', 'inline-decorated']:
                    faces = [str(ref.get_object().get('/BaseFont', '')) for ref in reader.pages[0]['/Resources']['/Font'].values()]
                    result['fonts'] = faces
                    assert any('DMSerifDisplay-Regular' in face for face in faces), 'Second font was not selected'
                with pdfium.PdfDocument(data) as document:
                    page = document[0]
                    try:
                        result['pdfiumText'], words = inspect_page(page)
                        result['words'] = words
                        bitmap = page.render(scale=1.5)
                        image = bitmap.to_pil()
                        image.save(folder / 'pdfium-1.png')
                        image.close()
                        bitmap.close()
                    finally:
                        page.close()
                assert result['pdfiumText'] == expected, 'PDFium text content or order differs'
                assert [word['text'] for word in words] == expected.split(), 'Word boundaries differ'
                prefix, code, suffix = [word['box'] for word in words[:3]]
                assert prefix[2] <= code[0] and code[2] <= suffix[0], 'Initial inline words overlap'
                assert max(b[1] for b in [prefix, code, suffix]) - min(b[1] for b in [prefix, code, suffix]) < 4, 'Following text left the first line'
                lines = 1
                for previous, current in zip(words, words[1:]):
                    a, b = previous['box'], current['box']
                    if abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) < 5:
                        assert b[0] >= a[2] - .1, f"Overlapping words: {previous['text']} / {current['text']}"
                    else:
                        assert b[3] < a[1], f"Lines overlap or move upwards: {previous['text']} / {current['text']}"
                        lines += 1
                assert lines >= 4, 'The fixture did not wrap'
                assert all(19 <= w['box'][0] < w['box'][2] <= 221 for w in words), 'Text leaves the content box'
                if case['controlSha256']:
                    control = (folder / 'control.pdf').read_bytes()
                    assert sha256(control).hexdigest() == case['controlSha256']
                    with pdfium.PdfDocument(control) as document:
                        page = document[0]
                        try:
                            _, control_words = inspect_page(page)
                        finally:
                            page.close()
                    assert len(control_words) == 4
                    for observed, reference in zip(words[:4], control_words):
                        assert abs(observed['box'][0] - reference['box'][0]) < .05, 'Built-in font word spacing differs from whole-string painting'
                result.update(ok=True, lines=lines, pdfSha256=case['pdfSha256'])
            except Exception as error:
                result['error'] = str(error)
        report['ok'] = all(row['ok'] for row in report['cases'])
        report['previewScope'] = ('The unembedded Helvetica and Times fixtures are checked with independent PDFium previews. '
                                  'Their Fullbleed native previews can omit glyphs; pixel equality alone is not visual-fidelity evidence.')
        assert report['ok'], '; '.join(f"{r['isolation']}/{r['name']}: {r['error']}" for r in report['cases'] if not r['ok'])
        return report
    finally:
        (out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path, nargs='?', default=Path('output/inline-wrapping'))
    result = verify(parser.parse_args().out)
    print(json.dumps({'ok': result['ok'], 'cases': len(result['cases'])}))
