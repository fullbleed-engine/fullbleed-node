"""Synthetic invoice records and independent final-PDF layout checks."""
from decimal import Decimal
from hashlib import sha256
from html import escape
import re

from pypdf import PdfReader
import pypdfium2 as pdfium


def cases(original_html, css):
    result = [{'name': 'short', 'html': original_html, 'css': css, 'total': '1,870.00',
               'markers': ['Discovery & brand workshop', 'Digital design & implementation', 'Review & studio handoff']}]
    for name, count, wrapped in [('long', 24, False), ('empty', 0, False), ('wrapped', 12, True),
                                  *[(f'boundary-{n}', n, False) for n in (4, 5, 16, 17)]]:
        markers = [f'Service line {n:03d}' for n in range(1, count + 1)]
        detail = 'Synthetic invoice record for pagination review.'
        if wrapped:
            detail = 'Discuss requirements, prepare the design, implement the agreed changes, and document the handoff. ' * 3
        rows = ''.join('<tr><td><strong>' + escape(marker) + '</strong><p class="item-note">' + escape(detail) +
                       '</p></td><td class="number">1</td><td class="number">$25.00</td><td class="number">$25.00</td></tr>' for marker in markers)
        html, replacements = re.subn(r'<tbody>.*?</tbody>', '<tbody>' + rows + '</tbody>', original_html, flags=re.S)
        assert replacements == 1
        total = f'{Decimal(count) * Decimal("25.00"):,.2f}'
        assert html.count('$1,870.00') == 2
        html = html.replace('$1,870.00', '$' + total)
        result.append({'name': name, 'html': html, 'css': css, 'total': total, 'markers': markers})
    return result


def inspect(path, fixture):
    compact = lambda text: ''.join(text.split())
    reader = PdfReader(path, strict=True)
    texts = [compact(page.extract_text()) for page in reader.pages]
    joined = ''.join(texts)
    positions = []
    item_pages = set()
    for marker in fixture['markers']:
        marker = compact(marker)
        assert joined.count(marker) == 1, (fixture['name'], 'missing or duplicated item', marker)
        positions.append(joined.index(marker))
        found = [n for n, text in enumerate(texts) if marker in text]
        assert len(found) == 1, (fixture['name'], 'item split across pages', marker)
        item_pages.add(found[0])
    assert positions == sorted(positions), (fixture['name'], 'item order')
    assert '$' + fixture['total'] in texts[-1] and 'TOTALDUE' in texts[-1]
    assert 'Paymentinstructionsaresuppliedseparately.' in texts[-1]
    assert any('TOTALDUE' in text and 'Paymentinstructionsaresuppliedseparately.' in text for text in texts)
    for n, text in enumerate(texts):
        assert text.count(f'Page{n + 1}of{len(texts)}') == 1, (fixture['name'], 'page counter', n + 1)
        if n in item_pages:
            assert 'DESCRIPTIONHOURSRATEAMOUNT' in text, (fixture['name'], 'table headings', n + 1)
    if fixture['name'] in ('short', 'empty'):
        assert len(texts) == 1
    elif fixture['name'] in ('long', 'wrapped'):
        assert len(texts) > 1
    bounds = []
    with pdfium.PdfDocument(path) as document:
        assert len(document) == len(texts)
        for n in range(len(document)):
            page = document[n]
            width, height = page.get_size()
            assert abs(width - 595.276) < 0.1 and abs(height - 841.890) < 0.1
            text = page.get_textpage()
            boxes = []
            try:
                for index in range(text.count_chars()):
                    if not text.get_text_range(index, 1).strip():
                        continue
                    left, bottom, right, top = text.get_charbox(index)
                    assert left >= -0.25 and bottom >= -0.25 and right <= width + 0.25 and top <= height + 0.25, (
                        fixture['name'], 'text outside visible page', n + 1, index, [left, bottom, right, top])
                    boxes.append([left, bottom, right, top])
                assert boxes
                bounds.append({'page': n + 1, 'characters': len(boxes), 'textBox': [min(b[0] for b in boxes),
                    min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]})
            finally:
                text.close()
                page.close()
    return {'name': fixture['name'], 'pages': len(texts), 'items': len(fixture['markers']),
            'pdfSha256': sha256(path.read_bytes()).hexdigest(), 'allTextWithinPage': True,
            'orderedItemsOnce': True, 'repeatedTableHeadings': True, 'pageCounters': True,
            'totalAndPaymentTogether': True, 'pageBounds': bounds}
