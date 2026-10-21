"""Independently read the PDFs returned by the local invoice Worker."""
from hashlib import sha256
import json
from pathlib import Path
import sys
from PIL import Image
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(json.loads((ROOT / 'output/cloudflare-starter-verification/latest.json').read_text())['output'])
record = json.loads((folder / 'verification.json').read_text(encoding='utf-8'))
assert record['ok'] and record['serverStopped'] and record['recovery']
baseline = json.loads((folder / 'node-baseline.json').read_text(encoding='utf-8'))
checked = []
for item in record['records']:
    path = folder / (item['name'] + '.pdf')
    assert sha256(path.read_bytes()).hexdigest() == item['pdf']
    pdf = PdfReader(path)
    assert len(pdf.pages) == item['pages']
    text = ' '.join(' '.join(page.extract_text().split()) for page in pdf.pages)
    for expected in item['text']:
        assert expected in text, (item['name'], expected, text)
    # Readers insert spaces between glyphs when the invoice eyebrow uses tracking.
    for expected in item['trackedText']:
        assert expected in ''.join(text.split()), (item['name'], expected)
    name = 'sample' if item['name'] == 'after-errors' else item['name']
    expected = next(value for value in baseline['records'] if value['name'] == name)
    for index, digest in enumerate(expected['previews']):
        path = folder / f'{name}-{index + 1}.png'
        assert sha256(path.read_bytes()).hexdigest() == digest
        with Image.open(path) as preview:
            preview.load()
            assert preview.width > 100 and preview.height > 100
            assert preview.convert('RGB').getextrema() != ((255, 255),) * 3
    checked.append({'name': item['name'], 'pages': len(pdf.pages), 'text': item['text'], 'trackedText': item['trackedText']})
result = {'ok': True, 'packageVersion': record['packageVersion'], 'tarballSha256': record['tarballSha256'], 'records': checked}
(folder / 'independent-reader.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'records': len(checked), 'pages': sum(item['pages'] for item in checked), 'output': str(folder)}))
