"""Check that a pasted Helvetica template has visible browser preview text."""
import base64
import hashlib
import json

from playwright.sync_api import expect
from pypdf import PdfReader


def verify_edited_preview(page, pdf_path, out, check):
    pdf = PdfReader(pdf_path)
    fonts = [item.get_object() for item in pdf.pages[0]['/Resources']['/Font'].values()]
    names = sorted(str(font.get('/BaseFont')) for font in fonts)
    check('edited template uses unembedded standard Helvetica faces',
          bool(fonts) and all(name in ['/Helvetica', '/Helvetica-Bold'] for name in names)
          and all('/FontDescriptor' not in font for font in fonts))
    image = page.locator('#preview img')
    expect(image).to_have_count(1)
    result = image.evaluate('''async image => {
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i + 3] > 0 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 245) ink++;
      return {width: canvas.width, height: canvas.height, inkPixels: ink,
              png: canvas.toDataURL('image/png').split(',')[1]};
    }''')
    png = base64.b64decode(result.pop('png'))
    (out / 'edited-preview-decoded.png').write_bytes(png)
    result.update(fonts=names, pdfSha256=hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
                  decodedPreviewSha256=hashlib.sha256(png).hexdigest())
    (out / 'edited-preview-verification.json').write_text(
        json.dumps(result, indent=2) + '\n', encoding='utf-8', newline='\n')
    check('edited standard-font preview contains visible text', result['inkPixels'] > 500)
