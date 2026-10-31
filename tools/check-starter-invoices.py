"""Check actual starter invoice downloads, final text bounds, and all previews."""
import argparse
import base64
from datetime import datetime, timezone
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile

from playwright.sync_api import sync_playwright, expect
from starter_invoice import cases, inspect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['browser', 'react', 'vue'], required=True)
    site = parser.add_mutually_exclusive_group(required=True)
    site.add_argument('--dist', type=Path)
    site.add_argument('--origin', help='URL of the deployed starter, including its path.')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--templates', type=Path)
    source.add_argument('--archive', type=Path, help='The exact downloaded starter ZIP.')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--browser', choices=['chrome', 'firefox', 'webkit'], default='chrome')
    parser.add_argument('--quick', action='store_true', help='Check the short and 24-row invoices only.')
    parser.add_argument('--reference', type=Path, help='Compare PDF and every preview byte with a prior verification.')
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    if args.templates:
        original = (args.templates / 'invoice.html').read_text(encoding='utf-8')
        css = (args.templates / 'invoice.css').read_text(encoding='utf-8')
    else:
        with ZipFile(args.archive) as archive:
            assert archive.testzip() is None
            prefix = f'fullbleed-{args.kind}-starter/src/'
            original = archive.read(prefix + 'invoice.html').decode('utf-8').replace('\r\n', '\n')
            css = archive.read(prefix + 'invoice.css').decode('utf-8').replace('\r\n', '\n')
    fixtures = cases(original, css)
    if args.quick:
        fixtures = fixtures[:2]
    reference = {}
    if args.reference:
        proof = json.loads(args.reference.read_text(encoding='utf-8'))
        assert proof['ok']
        reference = {case['name']: case for case in proof['cases']}
        assert all(case['name'] in reference for case in fixtures)
    server = None
    thread = None
    if args.dist:
        root = args.dist.resolve()
        prefix = '/nested/invoices/'

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=str(root), **kw)

            def translate_path(self, raw):
                path = unquote(urlsplit(raw).path)
                if not path.startswith(prefix):
                    return str(root / 'does-not-exist')
                resolved = (root / path[len(prefix):]).resolve()
                return str(resolved if resolved.is_relative_to(root) else root / 'does-not-exist')

            def end_headers(self):
                self.send_header('Cache-Control', 'no-store')
                super().end_headers()

            def copyfile(self, source, output):
                try:
                    super().copyfile(source, output)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}{prefix}'
    else:
        origin = args.origin.rstrip('/') + '/'
    records = []
    network = []
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome') if args.browser == 'chrome' else getattr(p, args.browser).launch()
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
            page = context.new_page()
            page.on('request', lambda r: network.append({'method': r.method, 'url': r.url}))
            page.on('pageerror', lambda error: errors.append(str(error)))

            def ready():
                expect(page.locator('#download')).to_be_enabled(timeout=60000)
                expect(page.locator('#status')).to_contain_text('Ready.')

            def download(path):
                with page.expect_download() as event:
                    page.locator('#download').click()
                event.value.save_as(path)

            try:
                page.goto(origin + '?design=invoice', wait_until='domcontentloaded')
                ready()
                if page.locator('#auto-preview').count():
                    page.locator('#auto-preview').uncheck()
                page.locator('#template-editor summary').click()
                assert page.locator('#html-source').input_value() == original
                assert page.locator('#css-source').input_value() == css
                for fixture in fixtures:
                    folder = out / fixture['name']
                    folder.mkdir()
                    page.locator('#html-source').fill(fixture['html'])
                    page.locator('#generate').click()
                    ready()
                    (folder / 'input.html').write_text(fixture['html'], encoding='utf-8', newline='\n')
                    (folder / 'style.css').write_text(css, encoding='utf-8', newline='\n')
                    download(folder / 'document.pdf')
                    result = inspect(folder / 'document.pdf', fixture)
                    previews = page.locator('#preview img')
                    expect(previews).to_have_count(result['pages'])
                    result['previewSha256'] = []
                    for index in range(result['pages']):
                        encoded = previews.nth(index).evaluate('''async image => {
                            const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
                            let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text);
                        }''')
                        data = base64.b64decode(encoded, validate=True)
                        assert data.startswith(b'\x89PNG\r\n\x1a\n')
                        (folder / f'page-{index + 1}.png').write_bytes(data)
                        result['previewSha256'].append(sha256(data).hexdigest())
                    if reference:
                        prior = reference[fixture['name']]
                        assert result['pdfSha256'] == prior['pdfSha256'], fixture['name']
                        assert result['previewSha256'] == prior['previewSha256'], fixture['name']
                        result['pdfAndPreviewsMatchReference'] = True
                    if fixture['name'] == 'long':
                        for width, height in [(1440, 1000), (390, 844), (320, 760)]:
                            page.set_viewport_size({'width': width, 'height': height})
                            page.evaluate('window.scrollTo(0, 0)')
                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                            page.screenshot(path=str(folder / f'browser-{width}.png'))
                        page.set_viewport_size({'width': 1440, 'height': 1000})
                        previous = previews.first.get_attribute('src')
                        page.locator('#generate').click()
                        ready()
                        assert previews.first.get_attribute('src') != previous
                        download(folder / 'repeat.pdf')
                        assert (folder / 'document.pdf').read_bytes() == (folder / 'repeat.pdf').read_bytes()
                        result['repeatPdfBytesMatch'] = True
                    records.append(result)
                    print(f'{args.kind}/{fixture["name"]}: {result["pages"]} pages, all text within bounds', flush=True)
                assert not errors, errors
                assert all(row['method'] == 'GET' for row in network)
                record = {'ok': True, 'at': datetime.now(timezone.utc).isoformat(), 'kind': args.kind,
                          'origin': origin, 'browser': args.browser, 'browserVersion': browser.version,
                          'cases': records, 'errors': errors, 'nonGetRequests': 0,
                          'sourceSha256': {'html': sha256(original.encode()).hexdigest(), 'css': sha256(css.encode()).hexdigest()},
                          'scope': 'These synthetic invoice records, actual PDF downloads and displayed previews. No universal layout, accessibility, conformance or adoption claim.'}
                (out / 'verification.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
            except Exception:
                page.screenshot(path=str(out / 'failure.png'))
                (out / 'failure.json').write_text(json.dumps({'cases': records, 'errors': errors, 'network': network}, indent=2) + '\n', encoding='utf-8')
                raise
            finally:
                context.close()
                browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    print(json.dumps({'ok': True, 'kind': args.kind, 'cases': len(records), 'pages': sum(case['pages'] for case in records)}))


if __name__ == '__main__':
    main()
