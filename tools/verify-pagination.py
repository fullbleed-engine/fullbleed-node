"""Independent page/text/bounds checks for JavaScript-created pagination fixtures."""
from argparse import ArgumentParser
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import sys

from pypdf import PdfReader
import pypdfium2 as pdfium

parser = ArgumentParser()
parser.add_argument("root", type=Path, nargs="?", default=Path("output/pagination"))
parser.add_argument("--negative-control", action="store_true")
parser.add_argument("--browser", action="store_true")
args = parser.parse_args()
fixture = Path(__file__).resolve().parents[1] / "test/pagination-fixtures.mjs"
source_sha256 = sha256(fixture.read_bytes()).hexdigest()
if args.browser:
    assert not args.negative_control
    browser = json.loads((args.root / "verification.json").read_text())
    assert browser["ok"]
    prepared = json.loads((args.root.parent / "browser-verification/prepared.json").read_text())
    assert browser["package"] == prepared["package"] and browser["engine"] == prepared["engine"]
    assert browser["installedTarballSha256"] == prepared["installedTarballSha256"]
    assert source_sha256 == prepared["paginationSourceSha256"]
    renders = dict(packageVersion=prepared["package"], engineVersion=prepared["engine"], cases=[])
    assert len(prepared["pagination"]) == 9
    for case in prepared["pagination"]:
        name = "pagination-" + case["name"]
        renders["cases"].append(dict(**case, isolation="browser", file=name + ".pdf", pdfSha256=prepared["baselines"][name]["pdf"]))
else:
    renders = json.loads((args.root / "renders.json").read_text())
    assert len(renders["cases"]) == 18
    assert renders["sourceSha256"] == source_sha256
    if not args.negative_control:
        assert re.fullmatch(r"[a-f0-9]{64}", renders["tarballSha256"])
cases = []
expected_names = {"table-hidden", "table-clip", "table-hidden-visible", "table-visible-hidden", "table-auto", "table-scroll", "break-auto", "break-fixed", "footnote"}
expected_modes = {"browser"} if args.browser else {"worker", "process"}
assert {(c["name"], c["isolation"]) for c in renders["cases"]} == {(name, mode) for name in expected_names for mode in expected_modes}
for entry in renders["cases"]:
    pdf = args.root / entry["file"] if args.browser else args.root / entry["directory"] / "document.pdf"
    assert sha256(pdf.read_bytes()).hexdigest() == entry["pdfSha256"]
    reader = PdfReader(pdf)
    texts = [page.extract_text() for page in reader.pages]
    checks = {}
    if entry["kind"] == "table":
        checks["multiple_pages"] = len(texts) > 2
        checks["every_row_once"] = Counter(re.findall(r"ROW-\s*(\d{3})", "\n".join(texts))) == Counter(f"{i:03}" for i in range(1, 81))
        checks["repeated_headers"] = all("Record" in t and "Details" in t for t in texts if "ROW-" in t)
    else:
        checks["page_count"] = len(texts) == entry["expectedPages"]
        if entry["kind"] == "break":
            checks["both_markers"] = "BEFORE" in texts[0] and "AFTER" in texts[-1]
            if entry["expectedPages"] == 2:
                checks["break_separates_markers"] = len(texts) == 2 and "AFTER" not in texts[0] and "BEFORE" not in texts[1]
        else:
            checks["preceding_line_retained"] = len(texts) == 2 and "First line stays here" in texts[0] and "First line stays here" not in texts[1]
            checks["footnotes_follow_call"] = len(texts) == 2 and "Second line has notes" not in texts[0] and all(s in texts[1] for s in ["Second line has notes", "first note", "second note"])
    outside = 0
    with pdfium.PdfDocument(pdf) as document:
        for page in document:
            width, height = page.get_size()
            text = page.get_textpage()
            try:
                for index in range(text.count_chars()):
                    if text.get_text_range(index, 1).strip():
                        left, bottom, right, top = text.get_charbox(index)
                        outside += int(left < -0.1 or bottom < -0.1 or right > width + 0.1 or top > height + 0.1)
            finally:
                text.close(); page.close()
    checks["glyphs_inside_pages"] = outside == 0
    cases.append(dict(name=entry["name"], isolation=entry["isolation"], pages=len(texts), off_page_glyphs=outside,
                      passed=all(checks.values()), checks=checks, pdf_sha256=entry["pdfSha256"]))
failed = [c for c in cases if not c["passed"]]
if args.negative_control:
    assert renders["packageVersion"] == "0.8.0" and renders["engineVersion"] == "2.5.29"
    expected = {c["name"] for c in cases if c["name"] != "break-fixed"}
    calibrated = all({c["name"] for c in failed if c["isolation"] == mode} == expected for mode in ["worker", "process"])
else:
    calibrated = not failed
result = dict(at=datetime.now(timezone.utc).isoformat(), ok=calibrated, package_version=renders["packageVersion"],
    engine_version=renders["engineVersion"], negative_control=args.negative_control, cases=cases,
    source_sha256=source_sha256, platform=sys.platform if args.browser else renders["platform"],
    tarball_sha256=prepared["installedTarballSha256"] if args.browser else renders["tarballSha256"],
    passed=sum(c["passed"] for c in cases), failed=len(failed),
    determinism="Browser PDFs and previews match the installed Node reference" if args.browser else "Repeated PDFs and worker/process PDFs/previews identical")
(args.root / ("pagination-verification.json" if args.browser else "verification.json")).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k:v for k,v in result.items() if k != "cases"}))
assert calibrated, [dict(name=c["name"], isolation=c["isolation"], checks=c["checks"]) for c in failed]
