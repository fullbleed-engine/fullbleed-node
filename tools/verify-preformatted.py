# SPDX-License-Identifier: MIT
"""Inspect the installed Node package's preformatted-block output."""
from hashlib import sha256
import argparse
import json
from pathlib import Path
from preformatted_inspection import verify

repo=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory',nargs='?',type=Path,default=repo/'output/preformatted-whitespace')
parser.add_argument('--negative-control',action='store_true')
parser.add_argument('--baseline',type=Path)
args=parser.parse_args()
source=repo/'test/fixtures/preformatted-whitespace-2.5.41.json'
renders=json.loads((args.directory/'renders.json').read_text(encoding='utf-8'))
if args.negative_control:
    assert renders['packageVersion']=='0.8.5' and renders['engineVersion']=='2.5.40'
else:
    package=json.loads((repo/'package.json').read_text(encoding='utf-8'))
    assert renders['packageVersion']==package['version'] and renders['engineVersion']==package['fullbleed']['engineVersion']
    assert renders['tarballSha256'], 'Candidate must render from the installed tarball'
report=verify(args.directory,source,['worker','process'],baseline=args.negative_control,require_previews=True)
unchanged=0
if args.baseline:
    baseline=json.loads((args.baseline/'verification.json').read_text(encoding='utf-8'))
    assert baseline['calibratedNegativeControl'] and baseline['inputSha256']==report['inputSha256']
    old={(row['mode'],row['name']):row for row in baseline['cases']}
    for row in report['cases']:
        previous=old[row['mode'],row['name']]
        if previous['ok']:
            assert row['pdfSha256']==previous['pdfSha256']
            assert row['nativeImages']==previous['nativeImages']
            unchanged+=1
    assert unchanged==14
summary=dict(ok=report['calibratedNegativeControl'] if args.negative_control else report['ok'],
    package_version=report['packageVersion'],engine_version=renders['engineVersion'],
    platform=renders['platform'],tarball_sha256=renders['tarballSha256'],source_sha256=sha256(source.read_bytes()).hexdigest(),
    negative_control=args.negative_control,cases=len(report['cases']),passed=report['passingCases'],failed=report['failingCases'],
    case_names=sorted({row['name'] for row in report['cases']}),
    failed_case_names=sorted({row['name'] for row in report['cases'] if not row['ok']}),unchanged_controls=unchanged)
(args.directory/'release-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary),flush=True)
