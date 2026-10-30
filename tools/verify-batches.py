"""Independently read and render the batch PDFs retained from the installed package."""
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
from io import BytesIO
import json
from pathlib import Path
import sys

from PIL import Image
from pypdf import PdfReader
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'output/batch-verification'
record = json.loads((folder / 'verification.json').read_text(encoding='utf-8'))
assert record['ok'] and record['queueClosed']
assert len(record['fixtures']) == 7 and len(record['readmeExamples']) == 2
pack = json.loads((root / 'output/pack-verification/verification.json').read_text(encoding='utf-8'))
assert pack['ok'] and pack['batchSmoke']['fixtures'] == record['fixtures']
assert pack['batchSmoke']['readmeExamples'] == record['readmeExamples']
plain = lambda text: ' '.join(text.split())
digest = lambda data: sha256(data).hexdigest()
expected_pages = {'batch-fixed': 2, 'batch-reflow': 5, 'batch-missing': 2, 'batch-components': 2,
                  'batch-literal': 1, 'batch-fallback-fixed': 2, 'batch-fallback-reflow': 2,
                  'readme-batch-1': 2, 'readme-batch-2': 1}
images = folder / 'independent-pages'
images.mkdir(exist_ok=True)
checked = []
for item in [*record['fixtures'], *record['readmeExamples']]:
    name = item['name']
    raw = (folder / (name + '.pdf')).read_bytes()
    assert digest(raw) == item['pdf']
    reader = PdfReader(BytesIO(raw), strict=True)
    texts = [plain(page.extract_text()) for page in reader.pages]
    assert len(texts) == item['pages'] == expected_pages[name]
    offset = 0
    ranges = []
    for index, row in enumerate(item['records']):
        assert row['recordIndex'] == index and row['pageOffset'] == offset and row['pageCount'] > 0
        text = plain(' '.join(texts[offset:offset + row['pageCount']]))
        if name == 'batch-literal':
            assert text == 'Café & <b>literal</b> "quoted" \\ path', text
        else:
            account, other = ('1042', '1043') if index == 0 else ('1043', '1042')
            assert 'Account ' + account in text and other not in text, (name, index, text)
            if name in ('batch-fixed', 'batch-reflow'):
                assert 'END ' + account in text
                message = 'Active.' if index == 0 else ('Review scheduled.' if name == 'batch-fixed'
                    else plain('This longer notice continues onto another page. ' * 20))
                assert message in text, (name, index, text)
            if name in ('batch-fallback-fixed', 'batch-fallback-reflow'):
                assert ('ASCII math' if index == 0 else 'Integral:') in text
                if index == 1 and name.endswith('reflow'):
                    assert '⨌' in text
            if name.startswith('readme-'):
                assert ('Your account is up to date.' if index == 0 else 'Your next review is scheduled for November.') in text
        ranges.append({**row, 'extractedText': text})
        offset += row['pageCount']
    assert offset == len(texts)
    if name == 'batch-reflow':
        assert [row['pageCount'] for row in item['records']] == [1, 4]
    if name == 'batch-missing':
        assert item['missingGlyphs'] == 1
        assert [[(glyph['codepoint'], glyph['count']) for glyph in row['missingGlyphs']] for row in item['records']] == [[(0x10ffff, 1)], [(0x10ffff, 3)]]
    elif name == 'batch-fallback-fixed':
        assert item['missingGlyphs'] == 1 and item['records'][0]['missingGlyphs'] == []
        assert item['records'][1]['missingGlyphs'] == [{'codepoint': 0x2a0c, 'char': '⨌', 'count': 1, 'fontsTried': ['Inter']}]
    else:
        assert item.get('missingGlyphs', 0) == 0 and all(not row['missingGlyphs'] for row in item['records'])
    document = pdfium.PdfDocument(raw)
    page_images = []
    assert len(document) == len(texts)
    for index in range(len(document)):
        page = document[index]
        bitmap = page.render(scale=1)
        image = bitmap.to_pil()
        path = images / f'{name}-{index + 1}.png'
        image.save(path)
        page_images.append({'file': str(path.relative_to(folder)), 'sha256': digest(path.read_bytes()),
                            'width': image.width, 'height': image.height})
        if item.get('previews'):
            preview = folder / f'{name}-{index + 1}.png'
            assert digest(preview.read_bytes()) == item['previews'][index]
            with Image.open(preview) as candidate:
                candidate.load()
                assert abs(candidate.width - image.width) <= 1 and abs(candidate.height - image.height) <= 1
        image.close()
        bitmap.close()
        page.close()
    document.close()
    checked.append({'name': name, 'pdf': item['pdf'], 'pages': len(texts), 'records': ranges, 'images': page_images})
result = {'ok': True, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'packageVersion': record['packageVersion'],
          'engineVersion': record['engineVersion'], 'tarballSha256': pack['tarballSha256'],
          'readers': {name: version(name) for name in ('pypdf', 'pypdfium2', 'Pillow')}, 'documents': checked,
          'scope': 'Expected text, page ranges, selected-font diagnostics, and independent PDFium page rendering for these nine installed-package examples. Visual review is separate; no conformance certification.'}
(folder / 'independent-reader.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'documents': len(checked), 'pages': sum(row['pages'] for row in checked)}))
