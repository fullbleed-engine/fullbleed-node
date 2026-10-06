"""Exercise the packed browser adapter in owned browsers and a disposable server."""
from datetime import datetime, timezone
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path
from threading import Thread, Event
from urllib.parse import unquote, urlsplit
import argparse
import json
import mimetypes
import time

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['chrome', 'firefox', 'webkit'], default='chrome')
parser.add_argument('--label', default='candidate')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
prepared = json.loads((root / 'output/browser-verification/prepared.json').read_text(encoding='utf-8'))
site = root / 'output/browser-verification/site'
out = root / f'output/browser-{args.browser}-{args.label}'
out.mkdir(exist_ok=False)
requests, errors, checks, documents = [], [], [], []
gates = {name: {'started': Event(), 'release': Event()} for name in ['slow-abort', 'slow-timeout']}
policy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self'; object-src 'none'; base-uri 'none'"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        request = {'method': 'GET', 'path': path}
        requests.append(request)
        relative = path.lstrip('/') or 'index.html'
        prefix = relative.split('/')[0]
        if prefix in ['wrong', 'corrupt', 'missing', *gates]:
            relative = 'fullbleed/' + relative.split('/', 1)[1]
        file = (site / relative).resolve()
        if not file.is_relative_to(site.resolve()) or not file.is_file():
            self.send_error(404)
            return
        if prefix in gates and relative.endswith('/engine.wasm'):
            gates[prefix]['started'].set()
            gates[prefix]['release'].wait(8)
        if prefix == 'missing' and relative.endswith('/engine.wasm'):
            self.send_error(404)
            return
        data = file.read_bytes()
        if prefix == 'wrong' and relative.endswith('/worker.js'):
            data = b'self.postMessage({type:"ready",protocol:1,version:"0.0.0",engineVersion:"0.0.0"});'
        if prefix == 'corrupt' and relative.endswith('/engine.wasm'):
            data = data[:-1] + bytes([data[-1] ^ 1])
        mime = 'application/javascript' if file.suffix == '.js' else 'application/wasm' if file.suffix == '.wasm' else mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        try:
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Content-Security-Policy', policy)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            request['connectionClosed'] = True  # A cancelled worker closes pending fetches.

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
base = f'http://127.0.0.1:{server.server_port}/'

def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True) if args.browser == 'chrome' else getattr(pw, args.browser).launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        network = []
        context.on('request', lambda request: network.append({'url': request.url, 'method': request.method, 'body': request.post_data}))
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto(base, wait_until='networkidle')
            page.wait_for_function('Boolean(globalThis.harness)')
            check('browser entry has the expected package and engine versions', page.evaluate('harness.api.version') == prepared['package'] and page.evaluate('harness.api.engineVersion') == prepared['engine'])
            for name, baseline in prepared['baselines'].items():
                result = page.evaluate('name => harness.render(name)', name)
                check(name + ': browser PDF and all previews match the installed Node package', result['pdf'] == baseline['pdf'] and result['previews'] == baseline['previews'] and result['pages'] == baseline['pages'] and result['missingGlyphs'] == baseline['missingGlyphs'])
                check(name + ': result uses browser byte arrays and requests worker termination', result['browserBytes'] and result['stats']['allTerminatedOnce'])
                for preview in range(-1, len(result['previews'])):
                    with page.expect_download() as event:
                        page.evaluate('({name, preview}) => harness.download(name, preview)', {'name': name, 'preview': preview})
                    filename = name + ('.pdf' if preview == -1 else f'-{preview + 1}.png')
                    path = out / filename
                    event.value.save_as(path)
                    expected = baseline['pdf'] if preview == -1 else baseline['previews'][preview]
                    assert sha256(path.read_bytes()).hexdigest() == expected
                    documents.append({'file': filename, 'bytes': path.stat().st_size, 'sha256': expected})
                    if args.browser == 'chrome':
                        # Chromium permits ten downloads per one-second burst.
                        # Pace this fixture loop so fast rendering stays below it.
                        page.wait_for_timeout(125)
                actual = PdfReader(out / (name + '.pdf'))
                reference = PdfReader(root / 'output/browser-verification' / (name + '.pdf'))
                check(name + ': independent reader confirms every page and text', [p.extract_text() for p in actual.pages] == [p.extract_text() for p in reference.pages])
            check('document scripts did not execute on the page', page.evaluate('globalThis.documentUploadExecuted === undefined'))
            copied = page.evaluate("() => harness.render('custom', true)")
            check('caller-owned font and asset buffers are copied before awaiting', copied['pdf'] == prepared['baselines']['custom']['pdf'])

            invalid = page.evaluate("""async () => {
              const before = harness.stats().created;
              const inputs = [{html:'x',isolation:'process'},{html:'x',profile:'pdfua1'},
                {html:'x',assets:{'../secret':new Uint8Array([1])}},{html:'€'.repeat(1333334)}];
              const results = await Promise.all(inputs.map(input => harness.capture(harness.renderer.renderPdf(input))));
              return {results,created:harness.stats().created-before};
            }""")
            check('unsupported options, traversal and UTF-8 size limits fail before workers start', invalid['created'] == 0 and all(row.get('code') == 'INVALID_INPUT' and row.get('fullbleedError') for row in invalid['results']))
            configs = page.evaluate("""() => ['https://other.invalid/fullbleed/','/fullbleed','/fullbleed/?v=1'].map(assetBaseUrl => {
              try { harness.api.createRenderer({assetBaseUrl}); return null; } catch(error) { return error.code; }
            })""")
            check('asset locations require a same-origin directory', configs == ['INVALID_INPUT'] * 3)
            for name, options, code in [
                ('missing glyphs', {'html': '<p>Integral: ⨌</p>'}, 'MISSING_GLYPHS'),
                ('page limit', {'html': '<p>First</p><p>Second</p>', 'css': 'p {break-after:page}', 'maxPages': 1}, 'PAGE_LIMIT'),
            ]:
                failure = page.evaluate('options => harness.capture(harness.renderer.renderPdf(options))', options)
                check(name + ': structured error is returned', failure.get('code') == code and failure.get('fullbleedError'))

            already = page.evaluate("""async () => {
              const before = harness.stats().created, controller = new AbortController(); controller.abort();
              const result = await harness.capture(harness.renderer.renderPdf({html:'Cancelled',signal:controller.signal}));
              return {result,created:harness.stats().created-before};
            }""")
            check('already-aborted requests start no worker', already['created'] == 0 and already['result'].get('code') == 'ABORTED')
            race = page.evaluate("""async () => {
              const controller = new AbortController(); globalThis.abortOnConstruct = controller;
              try { return await harness.capture(harness.renderer.renderPdf({html:'Cancelled at construction',signal:controller.signal})); }
              finally { globalThis.abortOnConstruct = null; }
            }""")
            check('aborting during construction still terminates the returned worker', race.get('code') == 'ABORTED' and page.evaluate('harness.stats().allTerminatedOnce'))

            for prefix, code in [('slow-abort', 'ABORTED'), ('slow-timeout', 'TIMEOUT')]:
                page.evaluate("""prefix => {
                  globalThis.controller = new AbortController();
                  const renderer = harness.api.createRenderer({assetBaseUrl:new URL(prefix+'/',location.href)});
                  globalThis.pending = harness.capture(renderer.renderPdf({html:'Delayed runtime load',
                    signal:controller.signal,timeoutMs:prefix==='slow-timeout'?1500:10000}));
                }""", prefix)
                assert gates[prefix]['started'].wait(5), 'Observe actual engine fetching before interrupting it.'
                if prefix == 'slow-abort':
                    page.evaluate('controller.abort()')
                failure = page.evaluate('pending')
                gates[prefix]['release'].set()
                check(prefix + ': in-flight asset loading is interrupted', failure.get('code') == code and failure.get('fullbleedError') and page.evaluate('harness.stats().allTerminatedOnce'))

            for prefix, code in [('wrong', 'VERSION_MISMATCH'), ('missing', 'ENGINE_LOAD_FAILED'), ('corrupt', 'ENGINE_LOAD_FAILED')]:
                before = page.evaluate('harness.stats()')
                failure = page.evaluate("""prefix => harness.capture(harness.api.createRenderer({assetBaseUrl:new URL(prefix+'/',location.href)}).renderPdf({html:'PRIVATE_BROWSER_MARKER'}))""", prefix)
                check(prefix + ': invalid deployed assets reject the request', failure.get('code') == code and failure.get('fullbleedError'))
                if prefix == 'wrong':
                    check('mismatched workers receive no document payload', page.evaluate('harness.stats().postedMessages') == before['postedMessages'])
            recovered = page.evaluate("() => harness.render('invoice')")
            check('a normal render recovers after errors, timeout and cancellation', recovered['pdf'] == prepared['baselines']['invoice']['pdf'] and recovered['stats']['allTerminatedOnce'])
            check('all observed network requests are same-origin GETs without document upload', all(row['method'] == 'GET' and not row['body'] and row['url'].startswith(base) and 'PRIVATE_BROWSER_MARKER' not in row['url'] for row in network))
            check('no uncaught page exceptions', not errors)
            record = {'ok': True, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'browserEngine': args.browser,
              'browser': browser.version, 'playwright': version('playwright'), 'pypdf': version('pypdf'), 'package': prepared['package'],
              'engine': prepared['engine'], 'installedTarballSha256': prepared['installedTarballSha256'],
              'contentSecurityPolicy': policy, 'mainThreadWebAssemblyDisabled': True, 'checks': checks,
              'documents': documents, 'workerCalls': page.evaluate('harness.stats()'), 'network': network, 'serverRequests': requests,
              'pageErrors': errors, 'scope': 'Owned browser with synthetic fixtures. Termination instrumentation observes calls to the browser API, not OS thread-exit events. Playwright WebKit is not branded Safari.'}
            (out / 'verification.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
        except Exception:
            page.screenshot(path=str(out / 'failure.png'), full_page=True)
            (out / 'failure.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'requests': requests, 'network': network}, indent=2) + '\n', encoding='utf-8')
            raise
        finally:
            context.close()
            browser.close()
finally:
    for gate in gates.values():
        gate['release'].set()
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
