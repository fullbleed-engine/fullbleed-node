# SPDX-License-Identifier: MIT
"""Inspect installed worker/process radial gradients and retain release evidence."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from radial_gradient_inspection import verify, SOURCE, MODES

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', nargs='?', type=Path, default=ROOT / 'output/radial-gradient-endpoints')
parser.add_argument('--negative-control', action='store_true')
parser.add_argument('--baseline', type=Path)
args = parser.parse_args()
renders = json.loads((args.directory / 'renders.json').read_text(encoding='utf-8'))
if args.negative_control:
    assert renders['packageVersion'] == '0.8.6' and renders['engineVersion'] == '2.5.41'
else:
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    assert renders['packageVersion'] == package['version'] and renders['engineVersion'] == package['fullbleed']['engineVersion']
    assert renders['tarballSha256'], 'Candidate must be rendered from the installed tarball.'
report = verify(args.directory, baseline=args.negative_control)
invalid = sum(bool(row['stitchingBounds']['invalid']) for row in report['cases'])
matching = sum(row['coreReferenceMatches'] for row in report['cases'])
if args.negative_control:
    assert report['calibratedNegativeControl'] and report['failingColorCases'] == 18 and invalid == 20 and matching == 4
else:
    assert report['failingColorCases'] == invalid == 0 and matching == 24
preserved = 0
if args.baseline:
    assert not args.negative_control
    old = json.loads((args.baseline / 'verification.json').read_text(encoding='utf-8'))
    assert old['calibratedNegativeControl'] and old['packageVersion'] == '0.8.6'
    assert old['inputSha256'] == report['inputSha256'] and old['failingColorCases'] == 18
    before = {(row['mode'], row['name']): row for row in old['cases']}
    assert len(before) == len(old['cases']) == 24
    assert sum(bool(row['stitchingBounds']['invalid']) for row in old['cases']) == 20
    for current in report['cases']:
        previous = before[current['mode'], current['name']]
        if current['name'] in ('smooth-control', 'repeating-control'):
            assert previous['pdfSha256'] == current['pdfSha256']
            assert previous['nativePreviewSha256'] == current['nativePreviewSha256']
            assert all(previous['images'][reader]['rgbSha256'] == current['images'][reader]['rgbSha256'] for reader in ('native', 'pdfium'))
            preserved += 1
    assert preserved == 4
summary = dict(ok=report['ok'], package_version=renders['packageVersion'], engine_version=renders['engineVersion'],
    platform=renders['platform'], tarball_sha256=renders['tarballSha256'], wasm_sha256=renders['wasmSha256'],
    source_sha256=sha256(SOURCE.read_bytes()).hexdigest(), negative_control=args.negative_control,
    cases=len(report['cases']), passing_color_cases=report['passingColorCases'], failing_color_cases=report['failingColorCases'],
    invalid_stitching_cases=invalid, core_matching_cases=matching, unchanged_controls=preserved,
    case_names=sorted({row['name'] for row in report['cases']}),
    case_keys=sorted(row['mode'] + ':' + row['name'] for row in report['cases']),
    failed_case_names=sorted({row['name'] for row in report['cases'] if not row['outerColorCorrect']}))
(args.directory / 'release-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary), flush=True)
