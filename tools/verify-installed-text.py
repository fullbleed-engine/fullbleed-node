#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Read the actual packed-package PDF with a test-only independent parser."""
import argparse
import hashlib
from importlib import metadata
import json
from pathlib import Path

from pypdf import PdfReader


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--evidence-root", type=Path,
                    default=Path(__file__).resolve().parents[1] / "output/pack-verification")
args = parser.parse_args()
root = args.evidence_root.resolve()
packed = json.loads((root / "verification.json").read_text())
consumer = (root / packed["installDirectory"]).resolve()
assert consumer.is_relative_to(root), "Consumer must be inside the verification directory"
pdf = consumer / "installed.pdf"
digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
assert digest == packed["smoke"]["pdf"], "PDF differs from the verified packed-package artifact"
reader = PdfReader(pdf)
text = " ".join(" ".join(page.extract_text() for page in reader.pages).split())
expected = "Installed package Invoice NS-1042"
report = dict(ok=len(reader.pages) == 1 and text == expected,
              package=packed["package"], engine=packed["smoke"]["engine"],
              reader="pypdf", readerVersion=metadata.version("pypdf"),
              pdfSha256=digest, expected=expected, extracted=text)
(root / "text-extraction.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
assert report["ok"], "The installed package must emit one extractable copy of the authored text"
