"""Check retained PDF text and glyph positions against reviewed core fixtures."""
from argparse import ArgumentParser
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image

parser = ArgumentParser()
parser.add_argument("root", type=Path, nargs="?", default=Path("output/table-wrapping"))
parser.add_argument("--negative-control", action="store_true")
parser.add_argument("--browser", action="store_true")
parser.add_argument("--baseline", type=Path)
args = parser.parse_args()
fixture_path = Path(__file__).resolve().parents[1] / "test/fixtures/table-wrapping-2.5.37.json"
source_sha = sha256(fixture_path.read_bytes()).hexdigest()
source = json.loads(fixture_path.read_text(encoding="utf-8"))
fixtures = {case["name"]: case for case in source["cases"]}
assert len(fixtures) == 35
if args.browser:
    assert not args.negative_control and args.baseline is None
    browser = json.loads((args.root / "verification.json").read_text(encoding="utf-8"))
    prepared = json.loads((args.root.parent / "browser-verification/prepared.json").read_text(encoding="utf-8"))
    assert browser["ok"] and browser["package"] == prepared["package"] and browser["engine"] == prepared["engine"]
    assert browser["installedTarballSha256"] == prepared["installedTarballSha256"]
    assert prepared["tableWrappingSourceSha256"] == source_sha
    renders = {"packageVersion": prepared["package"], "engineVersion": prepared["engine"],
        "tarballSha256": prepared["installedTarballSha256"], "platform": browser["browserEngine"], "cases": []}
    for name in fixtures:
        baseline = prepared["baselines"]["table-wrapping-" + name]
        renders["cases"].append({"name": name, "isolation": "browser", "file": "table-wrapping-" + name + ".pdf",
            "pdfSha256": baseline["pdf"], "previewSha256": baseline["previews"]})
else:
    renders = json.loads((args.root / "renders.json").read_text(encoding="utf-8"))
    assert renders["sourceSha256"] == source_sha
    assert sha256((args.root / "inputs.json").read_bytes()).hexdigest() == source_sha
    assert renders["fontSha256"] == source["fontSha256"]
    assert sha256((args.root / "assets/FullbleedCJKTest-Regular.ttf").read_bytes()).hexdigest() == source["fontSha256"]
    if not args.negative_control:
        assert re.fullmatch(r"[a-f0-9]{64}", renders["tarballSha256"])
modes = {"browser"} if args.browser else {"worker", "process"}
assert len(renders["cases"]) == len(fixtures) * len(modes)
assert {(case["name"], case["isolation"]) for case in renders["cases"]} == {(name, mode) for name in fixtures for mode in modes}
normalized = lambda value: "".join(value.split())
records = []
for entry in renders["cases"]:
    fixture = fixtures[entry["name"]]
    pdf = args.root / entry["file"] if args.browser else args.root / entry["directory"] / "document.pdf"
    assert sha256(pdf.read_bytes()).hexdigest() == entry["pdfSha256"]
    if not args.browser:
        assert (pdf.parent / "input.html").read_text(encoding="utf-8") == fixture["html"]
        assert (pdf.parent / "style.css").read_text(encoding="utf-8") == fixture["css"]
    reader = PdfReader(pdf, strict=True)
    extracted = normalized("".join(page.extract_text() for page in reader.pages))
    boxes, all_text, second_left, second_right, independent_pngs = [], "", None, None, []
    with pdfium.PdfDocument(pdf) as document:
        for page_number, page in enumerate(document):
            text = page.get_textpage()
            try:
                contents = text.get_text_range()
                all_text += normalized(contents)
                for index in range(text.count_chars()):
                    if text.get_text_range(index, 1).strip():
                        boxes.append(list(text.get_charbox(index)))
                if "SECOND" in contents:
                    start = contents.index("SECOND")
                    second_left = text.get_charbox(start)[0]
                    second_right = text.get_charbox(start + len("SECOND") - 1)[2]
                bitmap = page.render(scale=1)
                try:
                    image = bitmap.to_pil().convert("RGB")
                    independent_pngs.append(sha256(image.tobytes()).hexdigest())
                    image.save(pdf.with_name(pdf.stem + f"-pdfium-{page_number+1}.png"))
                finally:
                    bitmap.close()
            finally:
                text.close()
                page.close()
    checks = {"one_page": len(reader.pages) == 1, "visible_text": bool(boxes)}
    if fixture["kind"] == "wrapping":
        expected = normalized(fixture["expectedText"])
        checks.update(pypdf_content=extracted == expected, pdfium_content=all_text == expected,
            left_inside_cell=bool(boxes) and min(b[0] for b in boxes) >= 23.9,
            vertical_page_bounds=bool(boxes) and min(b[1] for b in boxes) >= 23.9 and max(b[3] for b in boxes) <= 336.1)
        right = max((b[2] for b in boxes), default=0)
        checks["authored_wrapping"] = right > 206 if fixture["intentionalOverflow"] else right <= 206
    else:
        checks.update(pypdf_content=extracted == "FIRSTSECOND", pdfium_content=all_text == "FIRSTSECOND")
        minimum = fixture["secondCellMinimumLeftPt"]
        checks["authored_child_width"] = second_left is not None and (second_left >= minimum - 1 if minimum is not None else second_right <= 206)
    previews = []
    for index, expected in enumerate(entry["previewSha256"]):
        png = args.root / ("table-wrapping-" + fixture["name"] + f"-{index+1}.png") if args.browser else pdf.parent / f"preview-{index+1}.png"
        assert sha256(png.read_bytes()).hexdigest() == expected
        with Image.open(png) as image:
            checks["visible_preview_" + str(index+1)] = min(channel[0] for channel in image.convert("RGB").getextrema()) < 180
        previews.append(expected)
    assert len(previews) == len(reader.pages)
    records.append({"name": entry["name"], "isolation": entry["isolation"], "passed": all(checks.values()),
        "checks": checks, "pdf_sha256": entry["pdfSha256"], "preview_sha256": previews,
        "pdfium_pixel_sha256": independent_pngs, "text": extracted, "pdfium_text": all_text,
        "glyph_bounds": boxes, "second_left_pt": second_left, "second_right_pt": second_right})
failed = [record for record in records if not record["passed"]]
if args.negative_control:
    assert renders["packageVersion"] == "0.8.1" and renders["engineVersion"] == "2.5.35"
    expected_failures = {name for name, case in fixtures.items() if case["public081Fails"]}
    calibrated = all({case["name"] for case in failed if case["isolation"] == mode} == expected_failures for mode in modes)
else:
    calibrated = not failed
preserved = []
if args.baseline:
    old = json.loads((args.baseline / "verification.json").read_text(encoding="utf-8"))
    assert old["ok"] and old["negative_control"] and old["source_sha256"] == source_sha
    for current in records:
        previous = next(case for case in old["cases"] if case["name"] == current["name"] and case["isolation"] == current["isolation"])
        if not fixtures[current["name"]]["public081Fails"]:
            for key in ["pdf_sha256", "preview_sha256", "pdfium_pixel_sha256", "text", "pdfium_text", "glyph_bounds"]:
                assert current[key] == previous[key], (current["name"], current["isolation"], key)
            preserved.append({"name": current["name"], "isolation": current["isolation"]})
report = {"at": datetime.now(timezone.utc).isoformat(), "ok": calibrated, "package_version": renders["packageVersion"],
    "engine_version": renders["engineVersion"], "tarball_sha256": renders["tarballSha256"], "platform": renders["platform"],
    "negative_control": args.negative_control, "source_sha256": source_sha,
    "passed": len(records)-len(failed), "failed": len(failed), "unchanged_controls": preserved, "cases": records,
    "scope": source["scope"]}
(args.root / ("table-wrapping-verification.json" if args.browser else "verification.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: value for key, value in report.items() if key not in ["cases", "unchanged_controls"]}))
assert calibrated, [{"name": case["name"], "isolation": case["isolation"], "checks": case["checks"]} for case in failed]
