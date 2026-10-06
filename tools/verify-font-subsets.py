#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Independently check embedded programs, text and pixels from an installed npm package.

Font checks are shared verbatim with the verified Fullbleed 2.5.7 release checker:
https://github.com/fullbleed-engine/fullbleed-official/blob/v2.5.7/tools/smoke_font_subsets.py
These are development dependencies, never dependencies of the npm package.
"""
import argparse
from importlib import metadata
from io import BytesIO
import hashlib
import json
from pathlib import Path
import re
import struct

from fontTools.ttLib import TTFont
from pypdf import PdfReader
import pypdfium2 as pdfium


def fonts_in(resources_dict, seen=None):
    seen = set() if seen is None else seen
    resources_dict = resources_dict.get_object()
    fonts = resources_dict.get('/Font', {})
    fonts = fonts.get_object() if hasattr(fonts, 'get_object') else fonts
    for ref in fonts.values():
        font = ref.get_object()
        identity = getattr(ref, 'idnum', id(font))
        if identity in seen:
            continue
        seen.add(identity)
        for descendant in font.get('/DescendantFonts', [font]):
            descendant = descendant.get_object()
            descriptor = descendant.get('/FontDescriptor')
            if descriptor and '/FontFile2' in descriptor.get_object():
                yield font, descendant, descriptor.get_object()['/FontFile2'].get_object()
    xobjects = resources_dict.get('/XObject', {})
    xobjects = xobjects.get_object() if hasattr(xobjects, 'get_object') else xobjects
    for ref in xobjects.values():
        obj = ref.get_object()
        if obj.get('/Subtype') == '/Form' and '/Resources' in obj:
            yield from fonts_in(obj['/Resources'], seen)


def used_glyphs(font, descendant, original):
    used = {0}
    if '/W' in descendant:
        widths = descendant['/W']
        index = 0
        while index < len(widths):
            first = int(widths[index])
            value = widths[index + 1]
            if isinstance(value, list):
                used.update(range(first, first + len(value)))
                index += 2
            else:
                used.update(range(first, int(value) + 1))
                index += 3
    else:
        assert font['/Subtype'] == '/TrueType' and font['/Encoding'] == '/WinAnsiEncoding'
        cmap = original.getBestCmap()
        for code in range(256):
            try:
                character = bytes([code]).decode('cp1252')
            except UnicodeDecodeError:
                continue
            if ord(character) in cmap:
                used.add(original.getGlyphID(cmap[ord(character)]))
    order = original.getGlyphOrder()
    pending = list(used)
    while pending:
        gid = pending.pop()
        glyph = original['glyf'][order[gid]]
        if glyph.isComposite():
            for component in glyph.components:
                child = original.getGlyphID(component.glyphName)
                if child not in used:
                    used.add(child)
                    pending.append(child)
    return used


def check_font(font, descendant, stream, source, legacy):
    data = stream.get_data()
    original = TTFont(source)
    embedded = TTFont(BytesIO(data), checkChecksums=2)
    assert embedded['maxp'].numGlyphs == original['maxp'].numGlyphs
    assert embedded.reader['name'] == original.reader['name'], 'Font notices/names changed'
    padded = data + b'\0' * ((-len(data)) % 4)
    assert sum(struct.unpack(f'>{len(padded) // 4}I', padded)) & 0xffffffff == 0xb1b0afba
    keep = used_glyphs(font, descendant, original)
    before_order, after_order = original.getGlyphOrder(), embedded.getGlyphOrder()
    before_glyf, after_glyf = original.reader['glyf'], embedded.reader['glyf']
    before_loca, after_loca = original['loca'].locations, embedded['loca'].locations
    for gid in keep:
        before = before_glyf[before_loca[gid]:before_loca[gid + 1]]
        after = after_glyf[after_loca[gid]:after_loca[gid + 1]]
        assert before.rstrip(b'\0') == after.rstrip(b'\0'), f'Outline/instructions changed: {gid}'
        assert original['hmtx'][before_order[gid]] == embedded['hmtx'][after_order[gid]], f'Metrics changed: {gid}'
    for old_table, new_table in zip(original['cmap'].tables, embedded['cmap'].tables, strict=True):
        assert (old_table.platformID, old_table.platEncID, old_table.format) == (
            new_table.platformID, new_table.platEncID, new_table.format)
        if not hasattr(old_table, 'cmap'):
            continue
        for point, name in old_table.cmap.items():
            gid = original.getGlyphID(name)
            if gid in keep:
                assert point in new_table.cmap, f'Character mapping lost: {point}'
                assert embedded.getGlyphID(new_table.cmap[point]) == gid
    if not legacy:
        assert embedded['post'].formatType == 3 and len(embedded.reader['post']) == 32
        fields = ['advanceWidthMax', 'minLeftSideBearing', 'minRightSideBearing', 'xMaxExtent']
        original_header = tuple(getattr(embedded['hhea'], name) for name in fields)
        embedded['hhea'].recalc(embedded)
        assert original_header == tuple(getattr(embedded['hhea'], name) for name in fields)
        long_count = embedded['hhea'].numberOfHMetrics
        shared = any(gid >= long_count for gid in keep)
        for gid in range(embedded['maxp'].numGlyphs):
            if gid in keep:
                continue
            advance, bearing = embedded['hmtx'][after_order[gid]]
            assert bearing == 0
            if gid < long_count - 1 or (gid == long_count - 1 and not shared):
                assert advance == 0
    result = {'original_bytes': source.stat().st_size, 'program_bytes': len(data),
              'encoded_bytes': len(stream._data), 'retained_glyphs_and_components': len(keep),
              'tables': {tag: embedded.reader.tables[tag].length for tag in embedded.reader.keys()},
              'original_glyph_ids_outlines_metrics_and_mappings_preserved': True,
              'font_name_and_notice_table_preserved': True}
    original.close()
    embedded.close()
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def compact(text):
    return re.sub(r'\s+', '', text)


LAYOUT_FIELDS = ('htmlSha256', 'cssSha256', 'pages', 'text', 'previewsSha256', 'pdfiumPixelSha256')


def compare_layout(item, prior, reviewed=None):
    """Accept only the exact reviewed layout; retain the historical comparison."""
    if prior:
        for field in ['htmlSha256', 'cssSha256', 'pages']:
            assert item[field] == prior[field], (item['name'], field)
        assert ' '.join(item['text'].split()) == ' '.join(prior['text'].split()), (item['name'], 'content')
    expected = reviewed or prior
    if expected:
        for field in LAYOUT_FIELDS:
            assert item[field] == expected[field], (item['name'], field)
        if reviewed:
            assert item['pdfSha256'] == reviewed['pdfSha256'], (item['name'], 'pdfSha256')
    return bool(prior and all(item[field] == prior[field] for field in LAYOUT_FIELDS))


def verify(args):
    root = args.evidence_root.resolve()
    renders = json.loads((root / 'renders.json').read_text(encoding='utf-8'))
    assert renders['ok'] and len(renders['fixtures']) == 7
    baseline = json.loads((args.baseline / 'verification.json').read_text(encoding='utf-8')) if args.baseline else None
    if baseline:
        assert baseline['ok']
        assert baseline['fonts'] == renders['fonts'], 'Before/after source fonts changed'
    reviewed = json.loads(args.reviewed_layout.read_text(encoding='utf-8')) if args.reviewed_layout else None
    if reviewed:
        assert reviewed['schema'] == 'fullbleed.reviewed_inline_layout.v1'
        assert reviewed['engineVersion'] == renders['engineVersion'], 'Reviewed layout targets another engine'
        assert reviewed['fonts'] == renders['fonts'], 'Reviewed layout uses other font bytes'
        assert set(reviewed['fixtures']) == {'invoice', 'report'}, 'Only the two reviewed designed fixtures may change'
    report = dict(schema='fullbleed.node_font_subset_verification.v1', ok=False,
                  packageVersion=renders['packageVersion'], engineVersion=renders['engineVersion'],
                  node=renders['node'], platform=renders['platform'], fonts=renders['fonts'],
                  licenses=renders['licenses'],
                  legacyMetadataAllowed=args.allow_legacy_metadata, fixtures=[],
                  baselinePackageVersion=baseline['packageVersion'] if baseline else None,
                  reviewedLayoutSha256=digest(args.reviewed_layout.read_bytes()) if reviewed else None,
                  readers={name: metadata.version(name) for name in ['pypdf', 'pypdfium2', 'fonttools', 'pillow']},
                  scope='Retained synthetic fixtures; embedded-font, text and pixel checks. No speed, general parity or conformance claim.')
    destination = args.report or root / 'verification.json'
    try:
        originals = {}
        for item in renders['licenses']:
            source = (root / item['path']).resolve()
            assert source.is_relative_to(root) and digest(source.read_bytes()) == item['sha256']
            assert source.stat().st_size == item['bytes']
        for item in renders['fonts']:
            source = (root / item['path']).resolve()
            assert source.is_relative_to(root) and digest(source.read_bytes()) == item['sha256']
            assert source.stat().st_size == item['bytes']
            with TTFont(source) as font:
                key = font.reader['name']
                assert key not in originals
                originals[key] = (item['name'], source)
        all_fonts_seen = set()
        for fixture in renders['fixtures']:
            folder = (root / fixture['name']).resolve()
            assert folder.is_relative_to(root)
            assert digest((folder / 'input.html').read_bytes()) == fixture['htmlSha256']
            assert digest((folder / 'style.css').read_bytes()) == fixture['cssSha256']
            pdf = folder / 'document.pdf'
            assert digest(pdf.read_bytes()) == fixture['pdfSha256']
            assert pdf.stat().st_size == fixture['pdfBytes']
            for index, expected in enumerate(fixture['previewsSha256'], 1):
                assert digest((folder / f'preview-{index}.png').read_bytes()) == expected
            reader = PdfReader(pdf)
            assert len(reader.pages) == fixture['pages'] == len(fixture['previewsSha256'])
            text = ''.join(page.extract_text() for page in reader.pages)
            assert text.strip()
            if fixture['expectedText']:
                assert compact(text) == compact(fixture['expectedText'])
            checked = []
            seen = set()
            for page in reader.pages:
                for font, descendant, stream in fonts_in(page['/Resources'], seen):
                    with TTFont(BytesIO(stream.get_data())) as embedded:
                        name, source = originals[embedded.reader['name']]
                    item = check_font(font, descendant, stream, source, args.allow_legacy_metadata)
                    item['source'] = name
                    checked.append(item)
                    all_fonts_seen.add(name)
            assert checked
            if fixture['expectedFont']:
                used = {item['source'] for item in checked if item['retained_glyphs_and_components'] > 1}
                assert used == {fixture['expectedFont']}, (fixture['name'], used)
            pixels, pdfium_text = [], []
            with pdfium.PdfDocument(pdf) as document:
                assert len(document) == fixture['pages']
                for index in range(len(document)):
                    page = document[index]
                    text_page = page.get_textpage()
                    pdfium_text.append(text_page.get_text_range())
                    text_page.close()
                    bitmap = page.render(scale=1.25)
                    image = bitmap.to_pil()
                    pixels.append(digest(image.tobytes()))
                    image.save(folder / f'pdfium-{index + 1}.png')
                    bitmap.close()
                    page.close()
            assert compact(''.join(pdfium_text)) == compact(text), fixture['name']
            item = dict(fixture, text=text, pdfiumPixelSha256=pixels, embeddedFonts=checked,
                        independentTextReadersAgree=True)
            reviewed_case = reviewed['fixtures'].get(fixture['name']) if reviewed else None
            if baseline:
                prior = next(x for x in baseline['fixtures'] if x['name'] == fixture['name'])
                identical = compare_layout(item, prior, reviewed_case)
                assert item['pdfBytes'] < prior['pdfBytes'], fixture['name']
                item['beforePdfBytes'] = prior['pdfBytes']
                item['pdfReductionPercent'] = round(100 * (1 - item['pdfBytes'] / prior['pdfBytes']), 2)
                item['baselineTextAndPixelsIdentical'] = identical
            elif reviewed_case:
                compare_layout(item, None, reviewed_case)
            if reviewed_case:
                item['reviewedInlineLayoutMatched'] = True
            report['fixtures'].append(item)
        assert all_fonts_seen == {item['name'] for item in renders['fonts']}
        report['ok'] = True
    finally:
        destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-root', type=Path, default=Path(__file__).resolve().parents[1] / 'output/font-subsets')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--reviewed-layout', type=Path, help='Exact reviewed invoice/report layout; other fixtures retain the historical baseline')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--allow-legacy-metadata', action='store_true')
    report = verify(parser.parse_args())
    print(json.dumps({'ok': report['ok'], 'package': report['packageVersion'],
                      'engine': report['engineVersion'], 'fixtures': len(report['fixtures'])}))
