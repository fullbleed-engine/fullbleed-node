#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check JS-generated PDFs against retained counter, color and Chrome geometry expectations."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import json
from pathlib import Path
import re

from PIL import Image, ImageChops, ImageFilter
from pypdf import PdfReader
from pypdf.generic import ContentStream
from fontTools.ttLib import TTFont
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'test/fixtures/engine-2.5.22.json'
DECORATION_SOURCE = ROOT / 'test/fixtures/decoration-thickness.json'
COLORS = {'initial': (188, 108, 37), 'border': (224, 64, 32), 'background': (255, 224, 128)}


def decoration_widths(page, reader):
    widths=[]
    def visit(stream, resources, width=1.0, color=None, depth=0):
        assert depth < 12
        stack=[]
        for args,op in ContentStream(stream,reader).operations:
            if op==b'q':stack.append((width,color))
            elif op==b'Q':width,color=stack.pop()
            elif op==b'w':width=float(args[0])
            elif op==b'RG':color=tuple(map(float,args))
            elif op in (b'S',b's') and color and color[0]>.7 and color[1:]==(0.,0.):widths.append(width)
            elif op==b'Do':
                obj=resources['/XObject'][args[0]].get_object()
                if obj.get('/Subtype')=='/Form':visit(obj,obj.get('/Resources',resources),width,color,depth+1)
    visit(page.get_contents(),page['/Resources'])
    return widths


def color_bounds(image, color):
    difference = ImageChops.difference(image.convert('RGB'), Image.new('RGB', image.size, color))
    channels = [channel.point(lambda value: 255 if value < 24 else 0) for channel in difference.split()]
    mask = ImageChops.multiply(ImageChops.multiply(channels[0], channels[1]), channels[2])
    if color == COLORS['background']:
        mask = mask.filter(ImageFilter.MinFilter(3))
    bounds = mask.getbbox()
    return list(bounds) if bounds else None


def inspect(pdf, dpi):
    observations, images = [], []
    with pdfium.PdfDocument(pdf) as document:
        for page in document:
            text = page.get_textpage()
            try:
                chars = [[text.get_text_range(i, 1), *text.get_charbox(i)]
                         for i in range(text.count_chars()) if text.get_text_range(i, 1).strip()]
                observations.append(dict(size=list(page.get_size()), chars=chars))
                bitmap = page.render(scale=dpi / 72)
                try:
                    images.append(bitmap.to_pil().convert('RGB'))
                finally:
                    bitmap.close()
            finally:
                text.close()
                page.close()
    return observations, images


def check_case(case, pdf, previews, destination):
    checks = []
    def check(name, ok, **details):
        checks.append(dict(name=name, ok=bool(ok), **details))
    reader = PdfReader(pdf)
    check('page count', len(reader.pages) == case['pages'], actual=len(reader.pages), expected=case['pages'])
    observations, independent = inspect(pdf, case['previewDpi'])
    for index, image in enumerate(independent, 1):
        image.save(destination / f'pdfium-{index}.png')
    native = []
    for path in previews:
        with Image.open(path) as image:
            native.append(image.convert('RGB'))
    try:
        check('preview page count', len(native) == case['pages'])
        expected = case['expected']
        if case['family'] == 'counter':
            text = ''.join(page.extract_text() for page in reader.pages)
            labels = re.findall(r'CNT([\d.\-]+)END', re.sub(r'\s+', '', text))
            check('emitted counter labels', labels == expected['labels'], actual=labels, expected=expected['labels'])
        elif case['family'] in ('overflow', 'border-image'):
            for mode, images in [('preview', native), ('pdfium', independent)]:
                image = images[0]
                check(mode + ' dimensions', list(image.size) == expected['size'], actual=list(image.size))
                for probe in expected['probes']:
                    actual = list(image.getpixel((probe['x'], probe['y'])))
                    check(mode + ' interior color', max(abs(a-b) for a,b in zip(actual,probe['expected'])) <= 3,
                          x=probe['x'], y=probe['y'], actual=actual, expected=probe['expected'])
        elif case['family'] == 'first-letter':
            reference = expected['chromePages']
            same_text = len(observations) == len(reference) and all(
                ''.join(c[0] for c in actual['chars']) == ''.join(c[0] for c in wanted['chars'])
                for actual, wanted in zip(observations, reference))
            check('Chrome text and page sequence', same_text)
            check('Chrome page sizes', [p['size'] for p in observations] == [p['size'] for p in reference])
            delta = max((abs(a-b) for page, wanted in zip(observations,reference)
                         for actual, target in zip(page['chars'],wanted['chars'])
                         for a,b in zip(actual[1:],target[1:])), default=0) if same_text else None
            check('Chrome character geometry', delta is not None and delta <= expected['tolerancePt'],
                  maximumDeltaPt=delta, tolerancePt=expected['tolerancePt'])
            for mode, images in [('preview',native),('pdfium',independent)]:
                for index, (image, wanted) in enumerate(zip(images,reference), 1):
                    for name,color in COLORS.items():
                        bounds = color_bounds(image,color)
                        bounds = [n*72/case['previewDpi'] for n in bounds] if bounds else None
                        target = wanted['colorBoundsPt'][name]
                        delta = max(abs(a-b) for a,b in zip(bounds,target)) if bounds is not None and target is not None else 0 if bounds == target else None
                        check(mode+' Chrome '+name+' bounds', delta is not None and delta <= 1.5,
                              page=index, actualPt=bounds, expectedPt=target, maximumDeltaPt=delta)
        elif case['family'] == 'decoration':
            with TTFont(ROOT/'assets/fonts/Inter-Variable.ttf') as font:
                preferred=font['post'].underlineThickness
                units=font['head'].unitsPerEm
            size=expected['fontSizePx']
            wanted=max(.75,int(size*.1)*.75) if expected['variant']=='auto' else max(.75,round(size*.75*preferred/units,3))
            check('OpenType metric expectation', wanted==expected['widthPt'])
            widths=decoration_widths(reader.pages[0],reader)
            check('colored decoration stroke count',len(widths)==expected['strokes'],actual=widths)
            check('font-selected or explicit stroke widths',all(abs(value-wanted)<=.002 for value in widths),actual=widths,expectedPt=wanted)
            check('decoration text',' '.join(reader.pages[0].extract_text().split())==expected['text'])
            for mode,images in [('preview',native),('pdfium',independent)]:
                data=images[0].tobytes()
                check(mode+' has red decoration',any(r>150 and g<60 and b<60 for r,g,b in zip(data[0::3],data[1::3],data[2::3])))
        else:
            raise ValueError('Unknown fixture family: '+case['family'])
    finally:
        for image in [*native, *independent]:
            image.close()
    return dict(ok=all(item['ok'] for item in checks), checks=checks)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out',type=Path,nargs='?',default=ROOT/'output/engine-regressions')
    parser.add_argument('--browser',action='store_true',help='Read actual downloads and the browser verification record in OUT')
    parser.add_argument('--negative-control',action='store_true',help='Require public npm 0.4.0 to fail at least one case in each fix family')
    parser.add_argument('--negative-decoration-control',action='store_true',help='Require public npm 0.5.0 to fail the large from-font cases and preserve all explicit/automatic controls')
    args=parser.parse_args()
    assert not (args.browser and (args.negative_control or args.negative_decoration_control))
    assert not (args.negative_control and args.negative_decoration_control)
    source=json.loads(SOURCE.read_text(encoding='utf-8'))
    font=source['font']
    assert sha256((ROOT/'test/fonts'/font['file']).read_bytes()).hexdigest()==font['sha256']
    assert sha256((ROOT/'test/fonts'/font['license']).read_bytes()).hexdigest()==font['licenseSha256']
    decoration=json.loads(DECORATION_SOURCE.read_text(encoding='utf-8'))
    assert sha256((ROOT/'assets/fonts'/decoration['font']['file']).read_bytes()).hexdigest()==decoration['font']['sha256']
    cases={case['name']:case for case in [*source['cases'],*decoration['cases']]}
    out=args.out.resolve()
    if args.browser:
        origin=json.loads((out/'verification.json').read_text(encoding='utf-8'))
        assert origin['ok']
        downloads={item['file']:item for item in origin['documents']}
        assert len(downloads)==len(origin['documents'])
        records=[dict(name=name,isolation='browser',directory=name,pdfFile=name+'.pdf',previewFiles=[name+f'-{i+1}.png' for i in range(case['pages'])]) for name,case in cases.items()]
        package,engine=origin['package'],origin['engine']
    else:
        origin=json.loads((out/'renders.json').read_text(encoding='utf-8'))
        assert origin['ok']
        if origin.get('decorationOnly'):
            cases={name:case for name,case in cases.items() if case['family']=='decoration'}
        records=origin['cases']
        assert {(r['name'],r['isolation']) for r in records}=={(name,mode) for name in cases for mode in ('worker','process')}
        assert len(records)==len(cases)*2
        package,engine=origin['packageVersion'],origin['engineVersion']
    if args.negative_control:
        assert (package,engine)==('0.4.0','2.5.11')
    if args.negative_decoration_control:
        assert (package,engine)==('0.5.0','2.5.22') and origin.get('decorationOnly')
    report=dict(ok=False,checkedAt=datetime.now(timezone.utc).isoformat(),packageVersion=package,engineVersion=engine,
                sourceSha256=sha256(SOURCE.read_bytes()).hexdigest(),installedTarballSha256=origin.get('installedTarballSha256'),
                decorationSourceSha256=sha256(DECORATION_SOURCE.read_bytes()).hexdigest(),
                negativeControl=args.negative_control,negativeDecorationControl=args.negative_decoration_control,browser=args.browser,
                versions={name:version(name) for name in ('pypdf','pypdfium2','pillow','fonttools')},cases=[],
                scope='Retained emitted labels, interior colors, Chrome geometry, and independently measured font-decoration strokes. Browser equality follows the separate browser report; no general CSS or standards certification.')
    try:
        for record in records:
            case=cases[record['name']]
            destination=out/record['directory']
            destination.mkdir(exist_ok=True)
            pdf=out/record['pdfFile'] if args.browser else destination/'document.pdf'
            previews=[out/file for file in record['previewFiles']] if args.browser else [destination/f'preview-{i+1}.png' for i in range(record['pages'])]
            if args.browser:
                for path in [pdf,*previews]:
                    assert path.name in downloads, 'Missing browser download: '+path.name
                    receipt=downloads[path.name]
                    assert path.stat().st_size==receipt['bytes'] and sha256(path.read_bytes()).hexdigest()==receipt['sha256']
            if not args.browser:
                assert sha256(pdf.read_bytes()).hexdigest()==record['pdfSha256']
                assert [sha256(p.read_bytes()).hexdigest() for p in previews]==record['previewsSha256']
            try:
                result=check_case(case,pdf,previews,destination)
            except Exception as error:
                result=dict(ok=False,error=str(error))
            report['cases'].append(dict(name=case['name'],family=case['family'],isolation=record['isolation'],pdfSha256=sha256(pdf.read_bytes()).hexdigest(),**result))
        failed={r['family'] for r in report['cases'] if not r['ok']}
        report['failedFamilies']=sorted(failed)
        if args.negative_decoration_control:
            expected_failed={(name,mode) for name,c in cases.items()
                if c['expected']['variant']=='font' and c['expected']['fontSizePx']==40
                for mode in ('worker','process')}
            observed_failed={(r['name'],r['isolation']) for r in report['cases'] if not r['ok']}
            report['ok']=observed_failed==expected_failed and not any('error' in r for r in report['cases'])
        else:
            report['ok']=(failed=={c['family'] for c in cases.values()} and not any('error' in r for r in report['cases'])) if args.negative_control else not failed
        assert report['ok'], '; '.join(r['isolation']+'/'+r['name'] for r in report['cases'] if not r['ok'])
    finally:
        filename='engine-regressions.json' if args.browser else 'verification.json'
        (out/filename).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(ok=report['ok'],packageVersion=package,engineVersion=engine,cases=len(report['cases']),negativeControl=args.negative_control,negativeDecorationControl=args.negative_decoration_control,failedFamilies=report['failedFamilies'])))


if __name__=='__main__':
    main()
