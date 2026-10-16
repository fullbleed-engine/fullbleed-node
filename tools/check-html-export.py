"""Check static HTML from the installed tarball in an owned, isolated browser."""
from datetime import datetime, timezone
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import argparse
import json

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['chrome', 'firefox', 'webkit'], default='chrome')
parser.add_argument('--label', default='candidate')
parser.add_argument('--executable-path', help='Optional Chromium executable for an owned test browser')
args = parser.parse_args()
if not args.label or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in args.label):
    parser.error('label must contain only letters, digits, hyphens or underscores')
if args.executable_path and args.browser != 'chrome':
    parser.error('--executable-path is only supported with --browser chrome')
root = Path(__file__).resolve().parents[1]
packed = root / 'output/pack-verification'
pack = json.loads((packed / 'verification.json').read_text(encoding='utf-8'))
assert pack['ok']
consumer = packed / pack['installDirectory']
installed = consumer / 'node_modules/fullbleed'
pkg = json.loads((installed / 'package.json').read_text(encoding='utf-8'))
out = root / f'output/html-export-{args.browser}-{args.label}'
out.mkdir(exist_ok=False)
fixture = (consumer / 'html-export-fixtures.mjs').read_text(encoding='utf-8')
fixture_sha = sha256((consumer / 'html-export-fixtures.mjs').read_bytes()).hexdigest()
fixture = fixture.replace("'fullbleed/ui'", "'./ui.js'").replace("'fullbleed/ui/jsx-runtime'", "'./jsx-runtime.js'")
harness = """
import { htmlExportCases } from './fixtures.mjs';
const exports = htmlExportCases();
await Promise.all(Object.entries(exports).map(([name, html]) => new Promise(resolve => {
  const frame = document.createElement('iframe');
  frame.id = name;
  frame.title = name;
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = 'display:block;width:900px;height:340px;border:1px solid #ccc';
  frame.onload = resolve;
  frame.srcdoc = html.startsWith('<!doctype') ? html : '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
  document.body.append(frame);
})));
globalThis.htmlExports = exports;
document.documentElement.dataset.ready = 'true';
"""
files = {
    '/': ('text/html; charset=utf-8', b'<!doctype html><html><head><meta charset="utf-8"><title>Static HTML export verification</title></head><body><script type="module" src="/harness.mjs"></script></body></html>'),
    '/harness.mjs': ('text/javascript; charset=utf-8', harness.encode()),
    '/fixtures.mjs': ('text/javascript; charset=utf-8', fixture.encode()),
    '/ui.js': ('text/javascript; charset=utf-8', (installed / 'dist/ui.js').read_bytes()),
    '/jsx-runtime.js': ('text/javascript; charset=utf-8', (installed / 'dist/jsx-runtime.js').read_bytes()),
}
# Embedded CSS is the subject of this check. No workers, fonts, images, fetches
# or script inside the exported iframe documents are permitted.
policy = "default-src 'none'; script-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'"
requests, network, errors, checks, documents = [], [], [], [], []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        requests.append(path)
        if path not in files:
            self.send_error(404)
            return
        mime, body = files[path]
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Content-Security-Policy', policy)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'ok': False, 'packageVersion': pkg['version'], 'tarballSha256': pack['tarballSha256'],
          'fixtureSha256': fixture_sha,
          'playwright': version('playwright'), 'checks': checks, 'documents': documents,
          'requests': requests, 'network': network, 'errors': errors,
          'uiAssets': {name: sha256(body).hexdigest() for name, (_, body) in files.items() if name in ['/ui.js', '/jsx-runtime.js']}}
try:
    with sync_playwright() as pw:
        browser = (pw.chromium.launch(executable_path=args.executable_path, headless=True) if args.executable_path else pw.chromium.launch(channel='chrome', headless=True)) if args.browser == 'chrome' else getattr(pw, args.browser).launch(headless=True)
        report['browser'] = {'name': args.browser, 'version': browser.version}
        context = browser.new_context(viewport={'width': 960, 'height': 800})
        context.add_init_script("""
          const forbidden = () => { throw new Error('Static HTML must not start the PDF runtime'); };
          globalThis.Worker = forbidden;
          for (const key of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming', 'Module', 'Instance']) WebAssembly[key] = forbidden;
        """)
        context.on('request', lambda request: network.append(request.url))
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base + '/') else route.abort())
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto(base + '/', wait_until='networkidle')
            page.locator('html[data-ready="true"]').wait_for()
            exports = page.evaluate('htmlExports')
            expected = {item['name']: item['sha256'] for item in pack['componentSmoke']['exportRecords']}
            check('browser and installed Node expose the same export fixtures', set(exports) == set(expected))
            for name, html in exports.items():
                digest = sha256(html.encode()).hexdigest()
                check(name + ': browser HTML matches installed Node bytes', digest == expected[name])
                path = out / (name + '.html')
                path.write_text(html, encoding='utf-8', newline='')
                documents.append({'name': name, 'file': path.name, 'sha256': digest})
            check('JSX and functions export identical styled HTML', exports['jsx'] == exports['styled'])
            observations = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('iframe')].map(frame => {
              const doc = frame.contentDocument, view = frame.contentWindow;
              const amount = doc.querySelector('.amount'), row = doc.querySelector('.totals'), literal = doc.querySelector('.literal');
              return [frame.id, { styles: doc.styleSheets.length, inline: doc.querySelectorAll('[style]').length,
                scripts: doc.querySelectorAll('script').length, links: doc.querySelectorAll('link').length,
                customer: doc.querySelector('.customer').textContent,
                customerColor: view.getComputedStyle(doc.querySelector('.customer')).color,
                color: amount && view.getComputedStyle(amount).color,
                fontSize: amount && view.getComputedStyle(amount).fontSize,
                display: row && view.getComputedStyle(row).display,
                padding: row && view.getComputedStyle(row).paddingTop,
                gap: row && view.getComputedStyle(row).gap,
                before: literal && view.getComputedStyle(literal, '::before').content,
                after: literal && view.getComputedStyle(literal, '::after').content }];
            }))""")
            report['observations'] = observations
            for name, observed in observations.items():
                check(name + ': content and class selectors survive export', observed['customer'] == 'A < B & C')
                check(name + ': no injected scripts or stylesheet links', observed['scripts'] == observed['links'] == 0)
            for name in ['styled', 'override', 'jsx', 'fragment']:
                actual = observations[name]
                check(name + ': exactly one stylesheet applies class rules', actual['styles'] == 1 and actual['color'] == ('rgb(18, 52, 86)' if name == 'override' else 'rgb(194, 65, 12)'))
                check(name + ': component layout and inline styles apply', actual['display'] == 'flex' and actual['fontSize'] == '19px' and actual['padding'] == '12px' and actual['gap'] == '18px')
                check(name + ': less-than media query remains valid CSS', actual['customerColor'] == 'rgb(32, 64, 96)')
            for name in ['unstyled', 'fragmentUnstyled', 'sourcesRemoved']:
                actual = observations[name]
                check(name + ': no embedded, linked or inline CSS remains', actual['styles'] == actual['inline'] == actual['links'] == 0)
                if name != 'sourcesRemoved':
                    check(name + ': browser uses normal unstyled flow', actual['display'] == 'block' and actual['color'] == 'rgb(0, 0, 0)' and actual['fontSize'] == '16px')
            check('legacy export keeps inline styles without attaching CSS', observations['legacy']['styles'] == 0 and observations['legacy']['inline'] > 0)
            check('CSS raw text escaping preserves the exact content value', observations['styled']['before'] == '"</StYle><script>bad()</script>"')
            check('CSS raw text escaping preserves an already escaped angle bracket', observations['styled']['after'] == '"</style>"')
            for name in ['styled', 'unstyled', 'fragment']:
                page.locator('#' + name).screenshot(path=str(out / (name + '.png')))
            check('static export uses only the isolated authoring modules', set(requests) == set(files) and all(url.startswith(base + '/') and urlsplit(url).path in files for url in network))
            check('no JavaScript errors or forbidden PDF runtime calls occurred', not errors)
            report['ok'] = True
        finally:
            context.close()
            browser.close()
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
    report['checkedAt'] = datetime.now(timezone.utc).isoformat()
    (out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
