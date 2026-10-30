#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Inspect installed-package or actual browser downloads for hidden HTML text."""
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
import argparse
import json

from PIL import Image
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT=Path(__file__).resolve().parents[1]


def inspect(pdf, preview, destination):
    reader=PdfReader(pdf)
    text=[' '.join(page.extract_text().split()) for page in reader.pages]
    sizes=[[float(page.mediabox.width),float(page.mediabox.height)] for page in reader.pages]
    with Image.open(preview) as image:
        rgb=image.convert('RGB')
        native={'size':list(rgb.size),'sha256':sha256(rgb.tobytes()).hexdigest()}
        rgb.close()
    rasters=[]
    with pdfium.PdfDocument(pdf) as document:
        for index,page in enumerate(document):
            bitmap=page.render(scale=1)
            image=bitmap.to_pil().convert('RGB')
            rasters.append({'size':list(image.size),'sha256':sha256(image.tobytes()).hexdigest()})
            image.save(destination/f'{pdf.stem}-pdfium-{index+1}.png')
            image.close();bitmap.close();page.close()
    return {'pdf':sha256(pdf.read_bytes()).hexdigest(),'png':sha256(preview.read_bytes()).hexdigest(),
        'text':text,'page_sizes':sizes,'native':native,'pdfium':rasters}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out',type=Path,nargs='?',default=ROOT/'output/hidden-text')
    parser.add_argument('--browser',action='store_true')
    args=parser.parse_args()
    out=args.out.resolve()
    fixture=ROOT/'test/fixtures/hidden-text-2.5.24.json'
    source=json.loads(fixture.read_text(encoding='utf-8'))
    origin=json.loads((out/('verification.json' if args.browser else 'renders.json')).read_text(encoding='utf-8'))
    assert origin['ok']
    if args.browser:
        downloads={item['file']:item for item in origin['documents']}
        assert len(downloads)==len(origin['documents'])
    else:
        assert origin['fixtureSha256']==sha256(fixture.read_bytes()).hexdigest(), 'Rendered fixture identity changed'
        expected_cases={(case['name'],mode) for case in source['cases'] for mode in ('worker','process')}
        actual_cases={(case['name'],case['isolation']) for case in origin['cases']}
        assert actual_cases==expected_cases and len(origin['cases'])==len(expected_cases), 'Incomplete rendered case coverage'
    negative=origin.get('negativeControl',False)
    assert not (negative and args.browser)
    if negative:assert (origin['packageVersion'],origin['engineVersion'])==('0.5.0','2.5.22')
    else:
        package=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
        assert origin['engine' if args.browser else 'engineVersion']==package['fullbleed']['engineVersion']
        assert source['engineVersion']=='2.5.43', 'Preserve the historical hidden-text baseline'
    report={'ok':False,'checked_at':datetime.now(timezone.utc).isoformat(),'negativeControl':negative,
        'packageVersion':origin['package' if args.browser else 'packageVersion'],
        'engineVersion':origin['engine' if args.browser else 'engineVersion'],
        'baselineEngineVersion':source['engineVersion'],
        'installedTarballSha256':origin.get('installedTarballSha256'),
        'browser':args.browser,'fixture_sha256':sha256(fixture.read_bytes()).hexdigest(),
        'versions':{name:version(name) for name in ('pypdf','pypdfium2','pillow')},'cases':[],'failures':[],
        'scope':'Independent text, page size, and PNG decoding; PDFium source/control pixels are compared within this platform only.'}
    for isolation in (['browser'] if args.browser else ['worker','process']):
        for case in source['cases']:
            destination=out/('visibility-'+case['name'] if args.browser else isolation+'-'+case['name'])
            destination.mkdir(exist_ok=True)
            row={'name':case['name'],'isolation':isolation,'variants':{}}
            for variant in ['source','control']:
                stem='visibility-'+case['name']+'-'+variant if args.browser else variant
                parent=out if args.browser else destination
                pdf=parent/(stem+'.pdf')
                preview=parent/(stem+('-1.png' if args.browser else '.png'))
                if args.browser:
                    for path in [pdf,preview]:
                        assert path.name in downloads, 'Missing browser download: '+path.name
                        receipt=downloads[path.name]
                        assert path.stat().st_size==receipt['bytes'] and sha256(path.read_bytes()).hexdigest()==receipt['sha256']
                actual=inspect(pdf,preview,destination)
                expected=case['expected']
                actual['matches_expected']=(actual['pdf']==expected['pdf'] and actual['png']==expected['png']
                    and actual['text']==expected['text'] and actual['page_sizes']==[[375.0,225.0]]
                    and actual['native']['size']==[500,300])
                row['variants'][variant]=actual
            a,b=row['variants']['source'],row['variants']['control']
            row['source_control_pixels_match']=a['pdfium']==b['pdfium'] and a['native']==b['native']
            row['ok']=b['matches_expected'] and (negative and case['affectedInPreviousCore']
                or a['matches_expected'] and row['source_control_pixels_match'])
            if not row['ok']:report['failures'].append({'name':row['name'],'isolation':isolation})
            report['cases'].append(row)
    report['ok']=not report['failures']
    (out/'hidden-text-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key!='cases'}))
    assert report['ok'],report['failures']


if __name__=='__main__':main()
