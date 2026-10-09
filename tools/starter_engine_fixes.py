"""Check released layout fixes through real HTML/CSS editors and PDF downloads.

Expectations come from upstream regression fixtures or the explicit CSS box
coordinates, never from a second rendering of the candidate engine.
"""
import base64
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import re

from PIL import Image
from playwright.sync_api import expect
from pypdf import PdfReader
import pypdfium2 as pdfium


FIXTURES = Path(__file__).with_name('starter-engine-2.5.22.json')


def inspect_outputs(case, pdf_path, preview_path, out, check):
    """Independently inspect a downloaded PDF and its displayed preview."""
    name = case['name']
    reader = PdfReader(pdf_path)
    check(name + ': downloaded PDF has the expected page count', len(reader.pages) == case['pages'])
    text = '\n'.join(page.extract_text() for page in reader.pages)
    expected = case['expected']
    record = {'name': name, 'pages': len(reader.pages), 'text': text, 'probes': []}
    if 'labels' in expected:
        labels = re.findall(r'CNT([0-9.]+)END', text)
        check(name + ': sibling counter resets produce the required labels', labels == expected['labels'])
        record['labels'] = labels
    if 'text' in expected:
        check(name + ': decorated initial preserves the paragraph text',
              re.sub(r'\s+', '', text) == re.sub(r'\s+', '', expected['text']))
    if 'probes' in expected:
        document = pdfium.PdfDocument(pdf_path)
        try:
            pdf_page = document[0]
            try:
                bitmap = pdf_page.render(scale=case['previewDpi'] / 72)
                try:
                    raster = bitmap.to_pil().convert('RGB')
                    raster.save(out / (name + '-pdfium.png'))
                finally:
                    bitmap.close()
            finally:
                pdf_page.close()
        finally:
            document.close()
        with Image.open(preview_path) as displayed:
            preview = displayed.convert('RGB')
        for source, image in [('downloaded PDF', raster), ('displayed preview', preview)]:
            check(name + ': ' + source + ' has the expected dimensions', list(image.size) == expected['size'])
            probes = []
            for probe in expected['probes']:
                actual = list(image.getpixel((probe['x'], probe['y'])))
                probes.append({**probe, 'actual': actual})
            record['probes'].append({'source': source, 'values': probes})
            check(name + ': ' + source + ' matches independent color probes',
                  all(max(abs(a - b) for a, b in zip(p['actual'], p['expected'])) <= 3 for p in probes))
    record.update(pdfSha256=hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
                  previewSha256=hashlib.sha256(preview_path.read_bytes()).hexdigest())
    return record


def verify_engine_fixes(page, out, check, ready, *, manual=False,
                        html_selector='#html-source', css_selector='#css-source',
                        render_selector='#render-source', download_selector='#download',
                        preview_selector='#preview img', edit_sources=None):
    """Paste focused cases, inspect actual downloads, then restore the editor."""
    fixtures = json.loads(FIXTURES.read_text(encoding='utf-8'))
    evidence = out / 'engine-fixes'
    evidence.mkdir(exist_ok=False)
    original_html = page.locator(html_selector).input_value()
    original_css = page.locator(css_selector).input_value()
    def edit(html, css):
        if edit_sources is not None:
            edit_sources(html, css)
        else:
            page.locator(html_selector).fill(html)
            page.locator(css_selector).fill(css)
    records = []
    for case in fixtures['cases']:
        name = case['name']
        (evidence / (name + '.html')).write_text(case['html'], encoding='utf-8', newline='\n')
        (evidence / (name + '.css')).write_text(case['css'], encoding='utf-8', newline='\n')
        edit(case['html'], case['css'])
        if manual:
            page.locator(render_selector).click()
        ready()
        with page.expect_download() as event:
            page.locator(download_selector).click()
        pdf_path = evidence / (name + '.pdf')
        event.value.save_as(pdf_path)
        displayed = page.locator(preview_selector)
        expect(displayed).to_have_count(case['pages'])
        encoded = displayed.first.evaluate('''async image => {
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          return canvas.toDataURL('image/png').split(',')[1];
        }''')
        preview_path = evidence / (name + '-preview.png')
        preview_path.write_bytes(base64.b64decode(encoded, validate=True))
        record = inspect_outputs(case, pdf_path, preview_path, evidence, check)
        record['suggestedFilename'] = event.value.suggested_filename
        records.append(record)
    edit(original_html, original_css)
    if manual:
        page.locator(render_selector).click()
    ready()
    result = {'ok': True, 'fixturesSha256': hashlib.sha256(FIXTURES.read_bytes()).hexdigest(),
              'readers': {package: version(package) for package in ['pypdf', 'pypdfium2', 'pillow']},
              'scope': fixtures['scope'], 'cases': records}
    (evidence / 'verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8', newline='\n')
    return result
