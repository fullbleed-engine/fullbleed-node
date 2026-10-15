#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Independently inspect PDFs and native previews rendered from installed components."""
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
import argparse
import json

from PIL import Image, ImageChops
from pypdf import PdfReader
import pypdfium2 as pdfium

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('out', type=Path, nargs='?', default=Path(__file__).resolve().parents[1] / 'output/component-verification')
args = parser.parse_args()
root = args.out.resolve()
source = json.loads((root / 'verification.json').read_text(encoding='utf-8'))
assert source['ok'] and len(source['records']) == 7
records = []
for case in source['records']:
    path = root / (case['name'] + '.pdf')
    assert sha256(path.read_bytes()).hexdigest() == case['pdf']
    reader = PdfReader(path)
    text = '\n'.join(page.extract_text() for page in reader.pages)
    assert len(reader.pages) == case['pages']
    for expected in case['text']:
        assert expected in text, (case['name'], expected)
    if case['name'] == 'component-long':
        for index in range(1, 61):
            assert text.count(f'Work item {index:02}') == 1, f'Missing or duplicated work item {index}'
    fonts = []
    for page in reader.pages:
        for reference in page['/Resources'].get('/Font', {}).values():
            font = reference.get_object()
            for item in font.get('/DescendantFonts', [font]):
                descriptor = item.get_object()['/FontDescriptor'].get_object()
                embedded = descriptor.get('/FontFile2', descriptor.get('/FontFile3'))
                assert embedded and embedded.get_object().get_data(), 'Every used face must be embedded'
                fonts.append(str(descriptor['/FontName']))
    boxes = []
    with pdfium.PdfDocument(path) as document:
        for index, page in enumerate(document):
            width, height = page.get_size()
            assert abs(width - 595.28) < 1 and abs(height - 841.89) < 1, 'CSS @page must set A4'
            tp = page.get_textpage()
            for char in range(tp.count_chars()):
                if not tp.get_text_range(char, 1).strip():
                    continue
                left, bottom, right, top = tp.get_charbox(char)
                assert left >= -1 and bottom >= -1 and right <= width + 1 and top <= height + 1, (case['name'], index, char, 'off-page text')
            if case['name'] == 'component-layouts':
                content = tp.get_text_range()
                def box(label):
                    return tp.get_charbox(content.index(label))
                one, two = box('Stack one'), box('Stack two')
                left, right = box('Row left'), box('Row right')
                alpha, beta = box('Grid alpha'), box('Grid beta')
                assert abs(one[0] - two[0]) < 1 and one[1] > two[1] + 5, 'Stack must arrange text vertically'
                assert right[0] > left[0] + 100 and abs(left[1] - right[1]) < 1, 'Row must arrange text horizontally'
                assert beta[0] > alpha[0] + 100 and abs(alpha[1] - beta[1]) < 1, 'Grid must create two columns'
                boxes = [list(value) for value in [one, two, left, right, alpha, beta]]
            tp.close()
            bitmap = page.render(scale=1)
            independent = bitmap.to_pil().convert('RGB')
            assert ImageChops.difference(independent, Image.new('RGB', independent.size, 'white')).getbbox()
            independent.save(root / f'{case["name"]}-pdfium-{index + 1}.png')
            independent.close(); bitmap.close(); page.close()
            preview = root / f'{case["name"]}-{index + 1}.png'
            assert sha256(preview.read_bytes()).hexdigest() == case['previews'][index]
            with Image.open(preview) as image:
                assert image.format == 'PNG' and image.size == (794, 1123)
                assert ImageChops.difference(image.convert('RGB'), Image.new('RGB', image.size, 'white')).getbbox()
    records.append({'name': case['name'], 'pages': case['pages'], 'pdf': case['pdf'], 'text': text,
                    'embedded_fonts': sorted(set(fonts)), 'text_in_page_bounds': True, 'layout_boxes': boxes})
receipt = {'ok': True, 'packageVersion': source['packageVersion'], 'engineVersion': source['engineVersion'],
           'tarballSha256': source['tarballSha256'], 'platform': source['platform'],
           'versions': {name: version(name) for name in ['pypdf', 'pypdfium2', 'pillow']},
           'records': records, 'scope': 'Seven fixture documents: independent text, page bounds, embedded fonts, decoded native previews and PDFium renders; no standards conformance claim.'}
(root / 'inspection.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'documents': len(records), 'pages': sum(row['pages'] for row in records)}))
