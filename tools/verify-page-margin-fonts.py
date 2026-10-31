#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Read saved page-font PDFs independently and compare aliases with explicit faces."""
import argparse
from hashlib import sha256
from importlib.metadata import version
from io import BytesIO
import json
from pathlib import Path

from pypdf import PdfReader
import pypdfium2 as pdfium


def digest(data):
    return sha256(data).hexdigest()


def inspect(folder, source, expected):
    for filename, key in [('input.html', 'htmlSha256'), ('input.css', 'cssSha256'), ('document.pdf', 'pdfSha256')]:
        assert digest((folder / filename).read_bytes()) == source[key]
    data = (folder / 'document.pdf').read_bytes()
    reader = PdfReader(BytesIO(data), strict=True)
    assert len(reader.pages) == source['pages'] == len(expected['footerFaces'])
    pages, problems = [], []
    for number, page in enumerate(reader.pages):
        spans = []
        page.extract_text(visitor_text=lambda text, cm, tm, font, size: spans.append({
            'text': ' '.join(text.split()), 'font': str(font['/BaseFont']).split('+')[-1], 'size': size,
        }) if text.strip() and font else None)
        footers = [span for span in spans if span['text'].startswith('FOOTER')]
        assert len(footers) == 1, (folder, spans)
        footer = footers[0]
        if footer['font'] != expected['footerFaces'][number]:
            problems.append({'page': number + 1, 'field': 'footerFont', 'actual': footer['font'],
                             'expected': expected['footerFaces'][number]})
        if footer['size'] != expected['footerSize']:
            problems.append({'page': number + 1, 'field': 'footerSize', 'actual': footer['size'],
                             'expected': expected['footerSize']})
        faces = []
        for ref in page['/Resources']['/Font'].values():
            font = ref.get_object()
            faces.append(str(font['/BaseFont']).split('+')[-1])
            for descendant in font.get('/DescendantFonts', [font]):
                descriptor = descendant.get_object().get('/FontDescriptor')
                if descriptor is None or not any(key in descriptor.get_object() for key in ['/FontFile', '/FontFile2', '/FontFile3']):
                    problems.append({'page': number + 1, 'field': 'unembeddedFallback', 'font': str(font['/BaseFont'])})
        text = ' '.join(page.extract_text().split())
        assert 'Record Alpha' in text and 'body' in text
        pages.append({'text': text, 'footer': footer, 'fonts': sorted(faces)})
    pixels = []
    with pdfium.PdfDocument(data) as document:
        for number, page in enumerate(document):
            assert digest((folder / f'page-{number + 1}.png').read_bytes()) == source['nativePreviewSha256'][number]
            textpage = page.get_textpage()
            assert ' '.join(textpage.get_text_range().split()) == pages[number]['text']
            width, height = page.get_size()
            for index in range(textpage.count_chars()):
                char = textpage.get_text_range(index, 1)
                if not char or char.isspace():
                    continue
                left, bottom, right, top = textpage.get_charbox(index)
                assert min(left, bottom) >= -0.25 and right <= width + 0.25 and top <= height + 0.25
            bitmap = page.render(scale=96 / 72)
            original = bitmap.to_pil()
            image = original.convert('RGB')
            image.save(folder / f'page-{number + 1}-pdfium.png')
            pixels.append(digest(image.tobytes()))
            image.close()
            original.close()
            bitmap.close()
            textpage.close()
            page.close()
    return {**source, 'pages': pages, 'pdfiumPixelsSha256': pixels, 'problems': problems}


def verify(root, negative_control=False):
    root = Path(root).resolve()
    source = json.loads((root / 'renders.json').read_bytes())
    fixture_bytes = (root / 'fixture.json').read_bytes()
    fixture = json.loads(fixture_bytes)
    assert source['ok'] and source['isolation'] == 'process' and source['defaultStyles'] is False
    assert digest(fixture_bytes) == source['fixtureSha256']
    expected = {case['name']: case for case in fixture['cases']}
    assert len(expected) == len(source['cases']) == 8
    assert {case['name'] for case in source['cases']} == expected.keys()
    if negative_control:
        assert source['packageVersion'] == '0.9.0' and source['engineVersion'] == '2.5.46'
    native_path = Path(__file__).resolve().parents[1] / 'test/fixtures/page-margin-native-2.5.48.json'
    native_bytes = native_path.read_bytes()
    native = json.loads(native_bytes)
    assert native['fixtureSha256'] == source['fixtureSha256']
    native_cases = {case['name']: case for case in native['cases']}
    assert native_cases.keys() == expected.keys()
    report = {**{k: v for k, v in source.items() if k != 'cases'}, 'ok': False, 'negativeControl': negative_control,
              'readers': {name: version(name) for name in ['pypdf', 'pypdfium2', 'pillow']}, 'cases': [],
              'nativeReferenceSha256': digest(native_bytes), 'nativeMatchingDocuments': 0,
              'scope': fixture['scope']}
    try:
        for pair in source['cases']:
            case = {'name': pair['name']}
            for kind in ['control', 'alias']:
                folder = (root / pair['name'] / kind).resolve()
                assert folder.is_relative_to(root)
                specimen = expected[pair['name']]
                assert pair[kind]['htmlSha256'] == digest(specimen['html'].encode())
                assert pair[kind]['cssSha256'] == digest(specimen[kind + 'Css'].encode())
                case[kind] = inspect(folder, pair[kind], specimen)
            case['mismatches'] = [key for key in ['pages', 'nativePreviewSha256', 'pdfiumPixelsSha256']
                                  if case['alias'][key] != case['control'][key]]
            report['cases'].append(case)
        if negative_control:
            indexed = {case['name']: case for case in report['cases']}
            for name in ['local-alias', 'url-alias']:
                assert not indexed[name]['control']['problems']
                assert any(p['field'] == 'footerFont' for p in indexed[name]['alias']['problems'])
                assert indexed[name]['mismatches']
            report['publicFailureReproduced'] = True
        else:
            assert source['engineVersion'] == native['engineVersion']
            for case in report['cases']:
                assert not case['control']['problems'], case
                assert not case['alias']['problems'], case
                assert not case['mismatches'], case
                for kind in ['control', 'alias']:
                    for field in ['pdfSha256', 'pages', 'nativePreviewSha256', 'pdfiumPixelsSha256']:
                        assert case[kind][field] == native_cases[case['name']][kind][field], (case['name'], kind, field)
                    report['nativeMatchingDocuments'] += 1
        report['pairs'] = len(report['cases'])
        report['pages'] = sum(len(case['alias']['pages']) * 2 for case in report['cases'])
        report['ok'] = True
    finally:
        (root / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--negative-control', action='store_true')
    args = parser.parse_args()
    result = verify(args.directory, args.negative_control)
    print(json.dumps({key: result[key] for key in ['ok', 'packageVersion', 'engineVersion', 'negativeControl', 'pairs', 'pages']}))
