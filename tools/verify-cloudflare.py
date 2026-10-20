"""Independent content, font and image checks for the installed Workers entry."""
from hashlib import sha256
import json
from pathlib import Path
import sys
from PIL import Image
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(json.loads((ROOT / 'output/cloudflare-verification/latest.json').read_text())['output'])
record = json.loads((folder / 'verification.json').read_text(encoding='utf-8'))
assert record['ok'] and record['serverStopped'] and record['recovery']
checked = []
for item in record['records']:
    path = folder / item['output']
    assert sha256(path.read_bytes()).hexdigest() == item['pdf']
    pdf = PdfReader(path)
    assert len(pdf.pages) == item['pages']
    text = '\n'.join(page.extract_text() for page in pdf.pages)
    for expected in item['text']:
        assert expected in text, (item['name'], expected, text)
    if item.get('face'):
        faces = []
        for page in pdf.pages:
            resources = page['/Resources'].get_object()
            for font in resources.get('/Font', {}).get_object().values():
                faces.append(str(font.get_object().get('/BaseFont', '')))
        assert any(item['face'] in face for face in faces), faces
    for index, name in enumerate(item['previewFiles']):
        path = folder / name
        assert sha256(path.read_bytes()).hexdigest() == item['previews'][index]
        with Image.open(path) as preview:
            preview.load()
            assert preview.width > 100 and preview.height > 100
            assert preview.convert('RGB').getextrema() != ((255, 255),) * 3, name
    checked.append({'name': item['name'], 'file': item['output'], 'pages': len(pdf.pages), 'text': item['text'], 'previews': len(item['previewFiles'])})
result = {'ok': True, 'packageVersion': record['packageVersion'], 'tarballSha256': record['tarballSha256'], 'records': checked,
          'scope': 'Independent page/text/font and PNG decoding checks for the retained local workerd outputs. Not hosted-platform or accessibility conformance verification.'}
(folder / 'independent-reader.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'records': len(checked), 'pages': sum(item['pages'] for item in checked), 'output': str(folder)}))
