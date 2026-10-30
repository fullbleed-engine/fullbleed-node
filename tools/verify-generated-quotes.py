"""Read saved quotation PDFs independently of the generating engine."""
from argparse import ArgumentParser
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image

parser = ArgumentParser()
parser.add_argument('root', type=Path, nargs='?', default=Path('output/generated-quotes'))
parser.add_argument('--negative-control', action='store_true')
parser.add_argument('--browser', action='store_true')
parser.add_argument('--baseline', type=Path)
args = parser.parse_args()
source_file = Path(__file__).resolve().parents[1]/'test/fixtures/generated-quotes-2.5.38.json'
source_sha = sha256(source_file.read_bytes()).hexdigest()
source = json.loads(source_file.read_text(encoding='utf-8'))
fixtures = {case['name']: case for case in source['cases']}
assert len(fixtures) == 41
if args.browser:
    assert not args.negative_control and args.baseline is None
    browser = json.loads((args.root/'verification.json').read_text(encoding='utf-8'))
    prepared = json.loads((args.root.parent/'browser-verification/prepared.json').read_text(encoding='utf-8'))
    assert browser['ok'] and browser['package'] == prepared['package'] and browser['engine'] == prepared['engine']
    assert browser['installedTarballSha256'] == prepared['installedTarballSha256']
    assert prepared['generatedQuotesSourceSha256'] == source_sha
    renders = dict(packageVersion=prepared['package'], engineVersion=prepared['engine'], tarballSha256=prepared['installedTarballSha256'], platform=browser['browserEngine'], cases=[])
    for name in fixtures:
        baseline = prepared['baselines']['generated-quotes-'+name]
        renders['cases'].append(dict(name=name,isolation='browser',file='generated-quotes-'+name+'.pdf',pdfSha256=baseline['pdf'],previewSha256=baseline['previews']))
else:
    renders = json.loads((args.root/'renders.json').read_text(encoding='utf-8'))
    assert renders['sourceSha256'] == source_sha
    assert sha256((args.root/'inputs.json').read_bytes()).hexdigest() == source_sha
if not args.negative_control:
    assert re.fullmatch(r'[a-f0-9]{64}', renders['tarballSha256'])
    package = json.loads((source_file.parents[2] / 'package.json').read_text(encoding='utf-8'))
    assert renders['packageVersion'] == package['version'] and renders['engineVersion'] == package['fullbleed']['engineVersion']
modes = {'browser'} if args.browser else {'worker','process'}
assert len(renders['cases']) == len(fixtures)*len(modes)
assert {(c['name'],c['isolation']) for c in renders['cases']} == {(name,mode) for name in fixtures for mode in modes}
normalize = lambda text: ''.join(text.split())
records = []
for entry in renders['cases']:
    fixture = fixtures[entry['name']]
    pdf = args.root/entry['file'] if args.browser else args.root/entry['directory']/'document.pdf'
    assert sha256(pdf.read_bytes()).hexdigest() == entry['pdfSha256']
    if not args.browser:
        assert (pdf.parent/'input.html').read_text(encoding='utf-8') == fixture['html']
        assert (pdf.parent/'style.css').read_text(encoding='utf-8') == fixture['css']
    reader = PdfReader(pdf, strict=True)
    text = normalize(''.join(page.extract_text() or '' for page in reader.pages))
    independent_text, pixels = '', []
    with pdfium.PdfDocument(pdf) as document:
        for number,page in enumerate(document,1):
            textpage = page.get_textpage()
            try:
                independent_text += normalize(textpage.get_text_range())
                bitmap = page.render(scale=1)
                try:
                    image = bitmap.to_pil().convert('RGB')
                    pixels.append(sha256(image.tobytes()).hexdigest())
                    image.save(pdf.with_name(pdf.stem+f'-pdfium-{number}.png'))
                finally:
                    bitmap.close()
            finally:
                textpage.close()
                page.close()
    checks = dict(one_page=len(reader.pages)==1, pypdf_text=text==fixture['expectedText'], pdfium_text=independent_text==fixture['expectedText'], page_geometry=all(abs(float(p.mediabox.width)-450)<0.01 and abs(float(p.mediabox.height)-300)<0.01 for p in reader.pages))
    assert len(entry['previewSha256']) == len(reader.pages)
    for number,expected in enumerate(entry['previewSha256'],1):
        png = args.root/('generated-quotes-'+entry['name']+f'-{number}.png') if args.browser else pdf.parent/f'preview-{number}.png'
        assert sha256(png.read_bytes()).hexdigest() == expected
        with Image.open(png) as image:
            checks['visible_preview_'+str(number)] = min(c[0] for c in image.convert('RGB').getextrema()) < 180
    records.append(dict(name=entry['name'],isolation=entry['isolation'],passed=all(checks.values()),checks=checks,text=text,pdfium_text=independent_text,pdf_sha256=entry['pdfSha256'],preview_sha256=entry['previewSha256'],pdfium_pixel_sha256=pixels))
failed = [row for row in records if not row['passed']]
if args.negative_control:
    assert renders['packageVersion']=='0.8.2' and renders['engineVersion']=='2.5.37'
    expected_failures = {name for name,c in fixtures.items() if c['previousEngineFails']}
    calibrated = all({r['name'] for r in failed if r['isolation']==mode}==expected_failures for mode in modes)
else:
    calibrated = not failed
preserved = []
if args.baseline:
    baseline = json.loads((args.baseline/'verification.json').read_text(encoding='utf-8'))
    assert baseline['ok'] and baseline['negative_control'] and baseline['source_sha256']==source_sha
    for row in records:
        if fixtures[row['name']]['previousEngineFails']:
            continue
        previous = next(c for c in baseline['cases'] if c['name']==row['name'] and c['isolation']==row['isolation'])
        for key in ['pdf_sha256','preview_sha256','pdfium_pixel_sha256','text','pdfium_text']:
            assert row[key]==previous[key],(row['name'],row['isolation'],key)
        preserved.append(dict(name=row['name'],isolation=row['isolation']))
report = dict(at=datetime.now(timezone.utc).isoformat(),ok=calibrated,package_version=renders['packageVersion'],engine_version=renders['engineVersion'],tarball_sha256=renders['tarballSha256'],platform=renders['platform'],negative_control=args.negative_control,source_sha256=source_sha,passed=len(records)-len(failed),failed=len(failed),unchanged_controls=preserved,cases=records,scope=source['scope'])
(args.root/('generated-quotes-verification.json' if args.browser else 'verification.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ['cases','unchanged_controls']}))
assert calibrated,[dict(name=r['name'],isolation=r['isolation'],checks=r['checks']) for r in failed]
