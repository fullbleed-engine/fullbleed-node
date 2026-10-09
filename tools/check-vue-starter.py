"""Check actual Vue PDF downloads, input races, cancellation and component cleanup."""
import argparse
from datetime import datetime, timezone
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
import json
from pathlib import Path
import re
import threading
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
from starter_standard_fonts import verify_edited_preview
from starter_engine_fixes import verify_engine_fixes

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dist', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--baseline', type=Path, default=Path('output/vue-baseline'))
parser.add_argument('--browser', choices=['chrome', 'firefox', 'webkit'], default='chrome')
args = parser.parse_args()
root = args.dist.resolve()
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=False)
prefix = '/nested/vue/'
policy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob:; font-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'"
paused = threading.Event()
requested = threading.Event()
released = threading.Event()
failed_engine = threading.Event()



class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(root), **kw)

    def translate_path(self, path):
        name = unquote(urlsplit(path).path)
        if not name.startswith(prefix):
            return str(root / 'not-found')
        resolved = (root / name[len(prefix):]).resolve()
        return str(resolved if resolved.is_relative_to(root) else root / 'not-found')

    def end_headers(self):
        self.send_header('Content-Security-Policy', policy)
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if failed_engine.is_set() and urlsplit(self.path).path.endswith('/fullbleed/engine.wasm'):
            self.send_error(503, 'Synthetic runtime outage')
            return
        if paused.is_set() and urlsplit(self.path).path.endswith('/fullbleed/engine.wasm'):
            requested.set()
            released.wait(15)
        super().do_GET()

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def log_message(self, *a):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
url = f'http://127.0.0.1:{server.server_port}{prefix}'
checks, documents, network, errors = [], [], [], []


def check(name, passed):
    assert passed, name
    checks.append(name)
    print(name + ': passed', flush=True)


audit_script = """(() => {
  const live = new Set(), urls = new Set(), blobs = new Map();
  const audit = {started: 0, terminated: 0, peak: 0, created: 0, revoked: 0};
  const RealWorker = window.Worker;
  window.Worker = class extends RealWorker {
    constructor(...args) { super(...args); live.add(this); audit.started++; audit.peak = Math.max(audit.peak, live.size); }
    terminate() { if (live.delete(this)) audit.terminated++; return super.terminate(); }
  };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (...args) => { const url = create(...args); urls.add(url); blobs.set(url, args[0]); audit.created++; return url; };
  URL.revokeObjectURL = url => { if (urls.delete(url)) audit.revoked++; blobs.delete(url); return revoke(url); };
  window.pdfLifecycle = () => ({...audit, live: live.size, urls: urls.size});
  window.pdfPreviewHashes = () => Promise.all(Array.from(document.querySelectorAll('#preview img'), async image => {
    const bytes = await blobs.get(image.src).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }));
})();"""
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome') if args.browser == 'chrome' else getattr(pw, args.browser).launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        context.add_init_script(audit_script)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: network.append({'url': request.url, 'method': request.method, 'body': request.post_data}))

        def ready():
            expect(page.locator('#download')).to_have_attribute('href', re.compile(r'^blob:'), timeout=45000)
            expect(page.locator('#status')).to_contain_text('Ready.')

        def hold_engine():
            requested.clear()
            released.clear()
            paused.set()

        def resume_engine():
            paused.clear()
            released.set()

        def download(name, count, text):
            with page.expect_download() as event:
                page.locator('#download').click()
            path = out / (name + '.pdf')
            event.value.save_as(path)
            pdf = PdfReader(path)
            contents = '\n'.join(item.extract_text() for item in pdf.pages)
            check(name + ': real PDF has expected pages and text', len(pdf.pages) == count and all(item in contents for item in text))
            documents.append({'name': name, 'pages': len(pdf.pages), 'filename': event.value.suggested_filename,
                              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            return path

        def previews_match(name, count):
            hashes = page.evaluate('pdfPreviewHashes()')
            expected = [hashlib.sha256((args.baseline / f'{name}-{index + 1}.png').read_bytes()).hexdigest() for index in range(count)]
            check(name + ': displayed previews match the installed Node package', hashes == expected)

        try:
            page.goto(url, wait_until='domcontentloaded')
            ready()
            initial = download('invoice', 1, ['Maple & Finch', 'NS-1042', '1,870.00'])
            check('invoice matches the installed Node package', initial.read_bytes() == (args.baseline / 'invoice.pdf').read_bytes())
            previews_match('invoice', 1)
            check('initial automatic render starts one worker', page.evaluate('pdfLifecycle().started === 1'))
            check('settled render terminates its worker', page.evaluate('pdfLifecycle().live === 0'))
            check('runtime resolves beneath a nested deployment path', any('/nested/vue/fullbleed/worker.js' in item['url'] for item in network))
            check('bundled interface font loads', page.evaluate("document.fonts.check('15px Inter')"))
            for width, height in [(1440, 1000), (390, 844), (320, 760)]:
                page.set_viewport_size({'width': width, 'height': height})
                check(f'{width}px: no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                page.screenshot(path=str(out / f'width-{width}.png'), full_page=True)
            page.set_viewport_size({'width': 1440, 'height': 1000})

            page.locator('#auto-preview').uncheck()
            starts = page.evaluate('pdfLifecycle().started')
            page.locator('#customer').fill('Manual Mode')
            page.wait_for_timeout(800)
            check('on-demand mode does not schedule a render after edits', page.evaluate('pdfLifecycle().started') == starts and page.locator('#download').is_disabled())
            page.locator('#generate').click()
            ready()
            download('manual', 1, ['Manual Mode', 'NS-1042'])
            page.locator('#customer').fill('Maple & Finch')
            page.locator('#auto-preview').check()
            ready()
            check('automatic rendering can be re-enabled', page.locator('#download').get_attribute('href').startswith('blob:'))

            hold_engine()
            page.locator('#customer').fill('Superseded record')
            expect(page.locator('#download')).to_be_disabled()
            check('edits immediately hide the old preview and release its URLs', page.locator('#preview img').count() == 0 and page.evaluate('pdfLifecycle().urls === 0'))
            assert requested.wait(8), 'Expected the first automatic render to request its engine.'
            starts = page.evaluate('pdfLifecycle().started')
            page.locator('#customer').fill('Birch & <Briar>')
            page.locator('#reference').fill('VUE-2042')
            page.locator('#accent').fill('#233b79')
            expect(page.locator('#download')).to_be_disabled()
            resume_engine()
            ready()
            updated = download('latest-input', 1, ['Birch & <Briar>', 'VUE-2042'])
            check('superseded render cannot overwrite the latest input', 'Superseded record' not in PdfReader(updated).pages[0].extract_text())
            check('a burst of edits is debounced into one new worker', page.evaluate('pdfLifecycle().started') == starts + 1)
            check('replacement does not overlap active worker handles', page.evaluate('pdfLifecycle().peak === 1'))
            check('only current PDF and preview URLs remain', page.evaluate('pdfLifecycle().urls === 2'))

            page.locator('#template-editor summary').click()
            page.locator('#html-source').fill('<h1>Vue template</h1><p>{{customer}} / {{reference}}</p><script>window.documentScriptExecuted = true;</script>')
            page.locator('#css-source').fill('@page { size: A5; margin: 15mm } body { font-family: Helvetica } h1 { color: {{ink}}; font-size: 24pt }')
            ready()
            edited = download('edited-template', 1, ['Vue template', 'Birch & <Briar>', 'VUE-2042'])
            check('edited print CSS changes the page size', abs(float(PdfReader(edited).pages[0].mediabox.width) - 419.52756) < 1)
            check('document scripts are not executed in the app', page.evaluate('window.documentScriptExecuted !== true'))
            verify_edited_preview(page, edited, out, check)
            page.screenshot(path=str(out / 'edited-template.png'), full_page=True)
            verify_engine_fixes(page, out, check, ready)
            page.locator('#kind').select_option('report')
            ready()
            report = download('report', 3, ['COMMON', '1,240', '420,000.00'])
            check('report matches the installed Node package', report.read_bytes() == (args.baseline / 'report.pdf').read_bytes())
            check('all report pages have previews', page.locator('#preview img').count() == 3)
            previews_match('report', 3)
            page.locator('#kind').select_option('invoice')
            check('each design preserves its template edits', 'Vue template' in page.locator('#html-source').input_value())
            page.locator('#html-source').fill('')
            expect(page.locator('#status')).to_contain_text('Enter document HTML')
            check('invalid input cannot leave an old download', page.locator('#download').is_disabled())
            page.locator('#reset-source').click()
            ready()

            starts = page.evaluate('pdfLifecycle().started')
            page.locator('#customer').fill('Cancelled before render')
            page.locator('#cancel').click()
            expect(page.locator('#status')).to_contain_text('Cancelled.')
            page.wait_for_timeout(800)
            check('cancelling a queued preview prevents its worker from starting', page.evaluate('pdfLifecycle().started') == starts and page.locator('#download').is_disabled())
            page.locator('#customer').fill('Birch & <Briar>')
            ready()

            failed_engine.set()
            page.locator('#generate').click()
            expect(page.locator('#status')).to_have_class('error', timeout=15000)
            check('runtime load failure clears previews and releases the worker', page.locator('#download').is_disabled() and page.evaluate('pdfLifecycle().live === 0 && pdfLifecycle().urls === 0'))
            failed_engine.clear()
            page.locator('#generate').click()
            ready()
            download('outage-recovery', 1, ['Birch & <Briar>', 'VUE-2042'])

            hold_engine()
            page.locator('#generate').click()
            assert requested.wait(8), 'Expected a held engine request before cancellation.'
            page.locator('#cancel').click()
            expect(page.locator('#status')).to_contain_text('Cancelled.')
            check('cancel removes the worker and stale download', page.locator('#download').is_disabled() and page.evaluate('pdfLifecycle().live === 0 && pdfLifecycle().urls === 0'))
            resume_engine()
            page.locator('#generate').click()
            ready()
            download('recovered', 1, ['Birch & <Briar>', 'VUE-2042'])

            page.locator('#toggle-editor').click()
            check('unmount releases ready PDF and preview URLs', page.evaluate('pdfLifecycle().live === 0 && pdfLifecycle().urls === 0'))
            hold_engine()
            page.locator('#toggle-editor').click()
            assert requested.wait(8), 'Expected the reopened editor to start rendering.'
            page.locator('#toggle-editor').click()
            check('unmount aborts a pending worker', page.evaluate('pdfLifecycle().live === 0 && pdfLifecycle().urls === 0'))
            resume_engine()
            page.locator('#toggle-editor').click()
            ready()
            reopened = download('remounted', 1, ['Maple & Finch', 'NS-1042'])
            check('remount starts from clean state and recovers', reopened.read_bytes() == initial.read_bytes())
            page.locator('#toggle-editor').click()
            lifecycle = page.evaluate('pdfLifecycle()')
            check('all created URLs and workers are released at final unmount', lifecycle['live'] == lifecycle['urls'] == 0 and lifecycle['created'] == lifecycle['revoked'] and lifecycle['started'] == lifecycle['terminated'])
            blob_origin = f'blob:http://127.0.0.1:{server.server_port}/'
            check('no uploads or cross-origin document requests', all(item['method'] == 'GET' and not item['body'] and item['url'].startswith((url, blob_origin)) for item in network))
            check('no uncaught page errors', not errors)
            (out / 'verification.json').write_text(json.dumps({'ok': True, 'checked_at': datetime.now(timezone.utc).isoformat(),
                'browser_engine': args.browser, 'browser': browser.version, 'vue_mode': 'production',
                'playwright': version('playwright'), 'pypdf': version('pypdf'), 'checks': checks, 'documents': documents,
                'lifecycle': lifecycle, 'network': network, 'page_errors': errors, 'csp': policy,
                'scope': 'Synthetic inputs; real installed package; worker counts observe API handles, not native thread-exit events.'}, indent=2) + '\n', encoding='utf-8')
        except Exception:
            page.screenshot(path=str(out / 'failure.png'), full_page=True)
            (out / 'failure.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'network': network}, indent=2) + '\n', encoding='utf-8')
            raise
        finally:
            context.close()
            browser.close()
finally:
    released.set()
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
