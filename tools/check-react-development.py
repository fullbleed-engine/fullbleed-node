"""Check real Vite source edits with React UI and Fullbleed print JSX together."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', type=Path, default=Path('examples/react'))
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--node', default=shutil.which('node'))
args = parser.parse_args()
project = args.project.resolve()
out = args.out.resolve(); out.mkdir(parents=True, exist_ok=False)
node = Path(args.node).resolve()
checks = []

def check(name, passed):
    assert passed, name
    checks.append(name)
    print(name + ': passed', flush=True)

# The copy resolves the parent's installed public dependencies, but all edited
# sources, generated runtime assets and Vite cache belong to this temporary app.
owned = project / 'output'; owned.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='component dev with spaces ', dir=owned) as temporary:
    copy = Path(temporary)
    assert copy.resolve().is_relative_to(owned.resolve()) and copy.resolve() != owned.resolve()
    for name in ['src', 'public']:
        shutil.copytree(project / name, copy / name)
    for name in ['index.html', 'package.json', 'tsconfig.json', 'vite.config.js']:
        shutil.copy2(project / name, copy / name)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}/'
    env = {**os.environ, 'PATH': str(node.parent) + os.pathsep + os.environ['PATH'], 'NODE_ENV': 'development'}
    with (out / 'vite.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([str(node), str(project / 'node_modules/vite/bin/vite.js'),
            '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=copy, env=env,
            stdout=log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            deadline = time.monotonic() + 30
            while True:
                assert process.poll() is None, 'Owned Vite server exited; inspect vite.log'
                try:
                    with urllib.request.urlopen(base, timeout=2) as response:
                        if response.status == 200: break
                except OSError:
                    pass
                assert time.monotonic() < deadline, 'Owned Vite server did not become ready'
                time.sleep(.2)
            errors = []
            documents = []
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                context = browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 1000})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))

                def ready():
                    expect(page.locator('#status')).to_contain_text('Ready.', timeout=45000)
                    expect(page.locator('#download')).to_have_attribute('href', re.compile(r'^blob:'))

                def download(name, expected):
                    ready()
                    with page.expect_download() as event: page.locator('#download').click()
                    path = out / (name + '.pdf'); event.value.save_as(path)
                    reader = PdfReader(path)
                    text = ''.join(''.join(p.extract_text().split()) for p in reader.pages)
                    check(name + ': actual PDF includes source and data edits', all(''.join(value.split()) in text for value in expected))
                    documents.append({'name': name, 'pages': len(reader.pages), 'sha256': sha256(path.read_bytes()).hexdigest()})
                    return path

                try:
                    page.goto(base, wait_until='domcontentloaded')
                    initial = download('initial', ['Good work.', 'Maple & Finch', '$8,100.00'])
                    baseline = project.parents[1] / 'output/react-baseline/component-invoice.pdf'
                    check('development JSX matches installed Node output', initial.read_bytes() == baseline.read_bytes())
                    page.locator('#customer').fill('Online edit & <preview>')
                    download('data-edit', ['Online edit & <preview>'])
                    previous = page.locator('#download').get_attribute('href')
                    source = copy / 'src/documents/Invoice.tsx'
                    before = source.read_text(encoding='utf-8')
                    assert before.count('Good work.') == 1
                    source.write_text(before.replace('Good work.', 'Built with JSX.'), encoding='utf-8', newline='\n')
                    expect(page.locator('#download')).not_to_have_attribute('href', previous, timeout=20000)
                    after_source = download('tsx-edit', ['Built with JSX.', 'Online edit & <preview>'])
                    check('editing print TSX retains React form state', page.locator('#customer').input_value() == 'Online edit & <preview>')
                    previous = page.locator('#download').get_attribute('href')
                    styles = copy / 'src/documents/invoiceStyles.ts'
                    before_style = styles.read_text(encoding='utf-8')
                    assert before_style.count('"42pt"') == 1
                    styles.write_text(before_style.replace('"42pt"', '"36pt"'), encoding='utf-8', newline='\n')
                    expect(page.locator('#download')).not_to_have_attribute('href', previous, timeout=20000)
                    after_style = download('style-edit', ['Built with JSX.', 'Online edit & <preview>'])
                    check('editing the attached stylesheet changes the PDF', after_style.read_bytes() != after_source.read_bytes())
                    sizes = []
                    PdfReader(after_style).pages[0].extract_text(visitor_text=lambda text, cm, tm, font, size: sizes.append(size) if text.strip() else None)
                    check('the edited heading size reaches the PDF', 36 in sizes and 42 not in sizes)
                    page.screenshot(path=str(out / 'source-edited.png'), full_page=True)
                    check('development source edits have no uncaught page errors', not errors)
                    (out / 'verification.json').write_text(json.dumps({'ok': True, 'checks': checks, 'documents': documents,
                        'page_errors': errors, 'browser': browser.version, 'mode': 'actual Vite development server',
                        'source_changes': {'Invoice.tsx': {'before': sha256(before.encode()).hexdigest(), 'after': sha256(source.read_bytes()).hexdigest()},
                            'invoiceStyles.ts': {'before': sha256(before_style.encode()).hexdigest(), 'after': sha256(styles.read_bytes()).hexdigest()}},
                        'scope': 'Owned temporary project, real TSX/style source edits, preserved form state and actual PDF downloads.'}, indent=2) + '\n', encoding='utf-8')
                except Exception:
                    page.screenshot(path=str(out / 'failure.png'), full_page=True)
                    (out / 'failure.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'documents': documents}, indent=2), encoding='utf-8')
                    raise
                finally:
                    context.close(); browser.close()
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
