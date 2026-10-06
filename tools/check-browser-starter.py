"""Exercise the built browser starter under a URL prefix with synthetic inputs."""
import argparse
from datetime import datetime, timezone
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit
from importlib.metadata import version

from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dist',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--browser',choices=['chrome','firefox','webkit'],default='chrome')
args=parser.parse_args()
root=args.dist.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=False)
prefix='/nested/demo/'
policy="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob:; font-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'"
pause_engine=threading.Event();engine_requested=threading.Event();release_engine=threading.Event()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
    def translate_path(self,path):
        path=unquote(urlsplit(path).path)
        if not path.startswith(prefix):return str(root/'does-not-exist')
        resolved=(root/path[len(prefix):]).resolve()
        return str(resolved if resolved.is_relative_to(root) else root/'does-not-exist')
    def end_headers(self):
        self.send_header('Content-Security-Policy',policy)
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def do_GET(self):
        if pause_engine.is_set() and urlsplit(self.path).path.endswith('/fullbleed/engine.wasm'):
            engine_requested.set();release_engine.wait(10)
        super().do_GET()
    def copyfile(self,source,outputfile):
        try:super().copyfile(source,outputfile)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
    def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
url=f'http://127.0.0.1:{server.server_port}{prefix}'
checks=[];network=[];errors=[];documents=[]
def check(name,passed):
    assert passed,name
    checks.append(name);print(name+': passed',flush=True)
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome') if args.browser=='chrome' else getattr(pw,args.browser).launch()
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        page=context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda r:network.append({'url':r.url,'method':r.method,'body':r.post_data}))
        def ready():
            expect(page.locator('#download')).to_be_enabled(timeout=45000)
            expect(page.locator('#status')).to_contain_text('Ready.')
        def download(name,pages,text):
            with page.expect_download() as event:page.locator('#download').click()
            item=event.value;path=out/(name+'.pdf');item.save_as(path)
            pdf=PdfReader(path);contents='\n'.join(p.extract_text() for p in pdf.pages)
            check(name+': download has the expected pages and text',len(pdf.pages)==pages and all(t in contents for t in text))
            documents.append({'name':name,'filename':item.suggested_filename,'pages':len(pdf.pages),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
            return path
        try:
            page.goto(url,wait_until='domcontentloaded');ready()
            check('runtime resolves beneath a nested deployment path',any('/nested/demo/fullbleed/worker.js' in r['url'] for r in network))
            check('bundled UI font loads',page.evaluate("document.fonts.check('15px Inter')"))
            download('invoice',1,['Maple & Finch','NS-1042','1,870.00'])
            for width,height in [(1440,1000),(390,844),(320,760)]:
                page.set_viewport_size({'width':width,'height':height})
                check(f'{width}px: no horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                page.screenshot(path=str(out/f'width-{width}.png'),full_page=True)
            page.set_viewport_size({'width':1440,'height':1000})
            page.locator('#customer').fill('Birch & <Briar>')
            expect(page.locator('#download')).to_be_disabled()
            check('changed inputs clear the previous preview',page.locator('#preview img').count()==0)
            page.locator('#reference').fill('TEST-2042')
            page.locator('#accent').fill('#233b79')
            page.locator('#generate').click();ready()
            download('customized',1,['Birch & <Briar>','TEST-2042'])
            check('customized bytes differ from the default invoice',documents[-1]['sha256']!=documents[0]['sha256'])
            page.locator('#template-editor summary').click()
            page.locator('#html-source').fill('<h1>Edited template</h1><p>{{customer}} / {{reference}}</p><script>window.documentScriptExecuted = true;</script>')
            page.locator('#css-source').fill('@page { size: A5; margin: 15mm } h1 { color: {{ink}}; font-size: 24pt }')
            page.locator('#render-source').click();ready()
            path=download('edited',1,['Edited template','Birch & <Briar>','TEST-2042'])
            check('edited print CSS changes the PDF page size',abs(float(PdfReader(path).pages[0].mediabox.width)-419.52756)<1)
            check('document script does not run on the page',page.evaluate('window.documentScriptExecuted !== true'))
            page.screenshot(path=str(out/'edited-template.png'),full_page=True)
            page.locator('#kind').select_option('report');page.locator('#generate').click();ready()
            download('report',3,['COMMON','1,240','420,000.00'])
            check('multi-page preview displays all report pages',page.locator('#preview img').count()==3)
            page.locator('#kind').select_option('invoice')
            check('each design preserves its template edits',page.locator('#html-source').input_value().startswith('<h1>Edited template'))
            page.locator('#reset-source').click()
            check('reset restores only the selected template', 'Northstar' in page.locator('#html-source').input_value())
            page.locator('#html-source').fill('')
            page.locator('#render-source').click()
            expect(page.locator('#status')).to_contain_text('nonempty')
            check('invalid input displays an error without a stale download',page.locator('#download').is_disabled())
            page.locator('#reset-source').click()
            pause_engine.set()
            page.locator('#generate').click()
            assert engine_requested.wait(5),'Worker did not request the held engine file'
            page.locator('#cancel').click()
            expect(page.locator('#status')).to_contain_text('Cancelled.')
            check('cancellation restores controls without a stale download',page.locator('#generate').is_enabled() and page.locator('#download').is_disabled())
            pause_engine.clear();release_engine.set()
            page.locator('#generate').click();ready()
            download('recovered',1,['Birch & <Briar>','TEST-2042'])
            local_blob=f'blob:http://127.0.0.1:{server.server_port}/'
            check('no document uploads or cross-origin runtime requests',all(r['method']=='GET' and not r['body'] and r['url'].startswith((url,local_blob)) for r in network))
            check('no uncaught page errors',not errors)
            report={'ok':True,'checked_at':datetime.now(timezone.utc).isoformat(),'browser_engine':args.browser,'browser':browser.version,'playwright':version('playwright'),'pypdf':version('pypdf'),'checks':checks,'documents':documents,'network':network,'page_errors':errors,'csp':policy,'scope':'Owned browser; synthetic inputs; production build served at /nested/demo/ with no PDF server.'}
            (out/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        except Exception:
            page.screenshot(path=str(out/'failure.png'),full_page=True)
            (out/'failure.json').write_text(json.dumps({'checks':checks,'errors':errors,'network':network},indent=2)+'\n',encoding='utf-8')
            raise
        finally:context.close();browser.close()
finally:release_engine.set();server.shutdown();server.server_close();thread.join(timeout=5)
