// SPDX-License-Identifier: MIT
use fullbleed::{Asset, AssetBundle, AssetKind, FullBleed};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

fn render_batch(
    engine: &FullBleed,
    html: &str,
    css: &str,
    reflow: bool,
) -> Result<(Vec<u8>, usize, usize, Value), Box<dyn std::error::Error>> {
    let encoded = std::fs::read("records.json")?;
    // JSON escaping can expand the bounded UTF-8 source, but cannot grow without limit.
    if encoded.len() > 32_000_000 {
        return Err("INVALID_BINDINGS: Encoded batch is too large.".into());
    }
    let records: Vec<HashMap<String, String>> = serde_json::from_slice(&encoded)
        .map_err(|error| format!("INVALID_BINDINGS: Invalid string records: {error}"))?;
    if records.is_empty() || records.len() > 10_000 {
        return Err("INVALID_BINDINGS: Expected between 1 and 10,000 records.".into());
    }
    let template = engine.compile_document(html, css)?;
    let slots = if reflow {
        template.reflow_binding_slots()
    } else {
        template.binding_slots()
    };
    if slots.is_empty() {
        return Err(
            "INVALID_BINDINGS: The template must contain plain-text {{field}} bindings.".into(),
        );
    }
    let mut columns: HashMap<String, Vec<String>> = slots
        .iter()
        .map(|slot| (slot.clone(), Vec::with_capacity(records.len())))
        .collect();
    for (index, mut record) in records.into_iter().enumerate() {
        if record.len() != slots.len() || slots.iter().any(|slot| !record.contains_key(slot)) {
            return Err(format!("INVALID_BINDINGS: Record {index} fields must exactly match the template bindings {slots:?}.").into());
        }
        for slot in slots {
            columns
                .get_mut(slot)
                .unwrap()
                .push(record.remove(slot).unwrap());
        }
    }
    let (pdf, report) = if reflow {
        template.render_reflow_bindings_to_buffer_with_report(&columns)?
    } else {
        template.render_bindings_to_buffer_with_report(&columns)?
    };
    let mut all_missing = HashSet::new();
    let rows: Vec<Value> = report
        .records
        .iter()
        .map(|row| {
            let missing: Vec<Value> = row.glyph_report.missing().iter().map(|glyph| {
            all_missing.insert(glyph.codepoint);
            json!({"codepoint":glyph.codepoint,"char":glyph.ch.to_string(),"count":glyph.count,
                "fontsTried":glyph.fonts_tried})
        }).collect();
            json!({"recordIndex":row.record_index,"pageOffset":row.page_offset,
            "pageCount":row.page_count,"missingGlyphs":missing})
        })
        .collect();
    let pages = report.page_count;
    let missing = all_missing.len();
    Ok((
        pdf,
        pages,
        missing,
        json!({"pages":pages,"missingGlyphs":missing,"records":rows}),
    ))
}

fn render() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let max_pages: usize = args.next().ok_or("Missing page limit")?.parse()?;
    let dpi: u32 = args.next().ok_or("Missing preview DPI")?.parse()?;
    let allow_missing = args.next().ok_or("Missing glyph policy")? == "allow";
    let mut fonts = AssetBundle::default();
    let mut batch = None;
    for font in args {
        if font.starts_with("--batch-") {
            let reflow = match font.as_str() {
                "--batch-fixed" => false,
                "--batch-reflow" => true,
                _ => return Err("INVALID_BINDINGS: Unknown batch layout.".into()),
            };
            if batch.replace(reflow).is_some() {
                return Err("INVALID_BINDINGS: Duplicate batch layout.".into());
            }
            continue;
        }
        let data = std::fs::read(&font)?;
        fonts.add(Asset::new(font, AssetKind::Font, data, None, true));
    }
    let html = std::fs::read_to_string("input.html")?;
    let css = std::fs::read_to_string("style.css")?;
    let engine = FullBleed::builder().register_bundle(fonts).build()?;
    let (pdf, pages, missing, report) = if let Some(reflow) = batch {
        render_batch(&engine, &html, &css, reflow)?
    } else {
        let (pdf, glyphs, document) = engine.render_with_glyph_report_and_document(&html, &css)?;
        let pages = document.pages.len();
        let missing = glyphs.missing().len();
        (
            pdf,
            pages,
            missing,
            json!({"pages":pages,"missingGlyphs":missing}),
        )
    };
    if pages == 0 || pages > max_pages {
        return Err(format!("PAGE_LIMIT: Rendered {pages} pages; maxPages is {max_pages}.").into());
    }
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
    std::fs::write("result.json", serde_json::to_vec(&report)?)?;
    Ok(())
}

fn main() {
    if let Err(error) = render() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
