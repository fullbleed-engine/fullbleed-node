// SPDX-License-Identifier: MIT
use fullbleed::{Asset, AssetBundle, AssetKind, FullBleed};

fn render() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let max_pages: usize = args.next().ok_or("Missing page limit")?.parse()?;
    let dpi: u32 = args.next().ok_or("Missing preview DPI")?.parse()?;
    let allow_missing = args.next().ok_or("Missing glyph policy")? == "allow";
    let mut fonts = AssetBundle::default();
    for font in args {
        let data = std::fs::read(&font)?;
        fonts.add(Asset::new(font, AssetKind::Font, data, None, true));
    }
    let html = std::fs::read_to_string("input.html")?;
    let css = std::fs::read_to_string("style.css")?;
    let engine = FullBleed::builder().register_bundle(fonts).build()?;
    let (pdf, glyphs, document) = engine.render_with_glyph_report_and_document(&html, &css)?;
    let pages = document.pages.len();
    if pages == 0 || pages > max_pages {
        return Err(format!("PAGE_LIMIT: Rendered {pages} pages; maxPages is {max_pages}.").into());
    }
    let missing = glyphs.missing().len();
    if missing > 0 && !allow_missing {
        return Err(format!("MISSING_GLYPHS: {missing} glyphs are unavailable. Supply fonts for the document's characters.").into());
    }
    std::fs::write("document.pdf", pdf)?;
    if dpi > 0 {
        let images = engine.render_finalized_pdf_image_pages("document.pdf", dpi)?;
        if images.len() != pages {
            return Err("PREVIEW_FAILED: Preview page count differs from the PDF.".into());
        }
        for (index, png) in images.iter().enumerate() {
            std::fs::write(format!("preview-{}.png", index + 1), png)?;
        }
    }
    std::fs::write(
        "result.json",
        format!("{{\"pages\":{pages},\"missingGlyphs\":{missing}}}"),
    )?;
    Ok(())
}

fn main() {
    if let Err(error) = render() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
