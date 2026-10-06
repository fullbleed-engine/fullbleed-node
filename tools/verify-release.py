#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Download the exact successful CI tarball and match its published release."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile

REPO = 'fullbleed-engine/fullbleed-node'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_binding(version, run_id, run, release, tag_commit, report):
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version), 'Use a stable numeric version')
    require(re.fullmatch(r'[0-9]+', run_id), 'Use a numeric CI run ID')
    require(run['status'] == 'completed' and run['conclusion'] == 'success', 'CI must have succeeded')
    require(run['name'] == 'Node integration' and run['headRepository']['nameWithOwner'] == REPO,
            'CI must belong to this repository')
    browser_release = tuple(map(int, version.split('.'))) >= (0, 3, 0)
    job_count = 13 if browser_release else 10
    require(len(run['jobs']) == job_count and all(j['conclusion'] == 'success' for j in run['jobs']),
            f'All {job_count} CI jobs must pass')
    if browser_release:
        expected = {'Build published engine and verify native output'}
        expected.update(f'Packed package ({os}, Node {node})' for os in ['ubuntu-latest', 'windows-latest', 'macos-latest'] for node in ['22', '24', '26'])
        expected.update(f'Browser package ({browser})' for browser in ['chrome', 'firefox', 'webkit'])
        require({job.get('name') for job in run['jobs']} == expected, 'Required browser and installed CI jobs are missing')
    require(not release['draft'] and not release['prerelease'] and release['tag_name'] == 'v' + version,
            'Require a published stable GitHub release')
    require(report['ok'] and report['package_version'] == version, 'Release version differs')
    require(run['headSha'] == tag_commit == report['source_commit'], 'Source commit differs')
    require(report['ci_run'] == f'https://github.com/{REPO}/actions/runs/{run_id}', 'CI run differs')
    require(report['ci_jobs'] == job_count and len(report['installed_matrix']) == 9,
            'Release does not retain the required installed matrix')
    if browser_release:
        browsers = report.get('browser_matrix', [])
        require(len(browsers) == 3 and {item.get('browser') for item in browsers} == {'chrome', 'firefox', 'webkit'},
                'Release does not retain the required browser matrix')
        require(all(item.get('ok') is True and item.get('package_version') == version and item.get('checks', 0) >= 30 for item in browsers),
                'Browser verification is incomplete or tests another package')


def verify_tarball(data, info, report):
    sha = hashlib.sha256(data).hexdigest()
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    require(sha == report['package_sha256'], 'Tarball SHA-256 differs')
    require(integrity == info['integrity'] == report['package_integrity'], 'Tarball integrity differs')
    require(len(data) == info['size'], 'Tarball size differs')
    require(info['name'] == 'fullbleed' and info['version'] == report['package_version'], 'Package differs')
    require(info['filename'] == f'fullbleed-{info["version"]}.tgz', 'Unexpected tarball filename')
    names = {f['path'] for f in info['files']}
    require(len(names) == len(info['files']) == report['package_files'], 'Duplicate package paths')
    require(all(name in {'LICENSE', 'README.md', 'package.json'} or name.startswith(('src/', 'dist/', 'assets/fonts/'))
                for name in names), 'Unexpected package file')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        require(len(members) == len(names), 'Archive file count differs')
        require({m.name for m in members} == {'package/' + n for n in names}, 'Archive file names differ')
        for member in members:
            path = PurePosixPath(member.name)
            require(member.isfile() and not path.is_absolute() and '..' not in path.parts
                    and '\\' not in member.name, 'Unsafe archive member')
        package = json.load(archive.extractfile('package/package.json'))
        require(package['name'] == 'fullbleed' and package['version'] == info['version'], 'Archived package differs')
        require(package['repository']['url'] == f'https://github.com/{REPO}.git', 'Repository differs')
        require(package['fullbleed']['engineVersion'] == report['engine_version'], 'Engine differs')
    require(all(item['tarball_sha256'] == sha for item in report['installed_matrix']), 'Matrix tested another tarball')
    if tuple(map(int, info['version'].split('.'))) >= (0, 3, 0):
        require({'dist/browser/client.js', 'dist/browser/worker.js', 'dist/browser/asset-manifest.json', 'src/browser.d.ts', 'src/copy-browser-assets.cjs'}.issubset(names),
                'Browser package files are missing')
        require(all(item['tarball_sha256'] == sha for item in report['browser_matrix']), 'Browser matrix tested another tarball')
    return sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--ci-run', required=True)
    parser.add_argument('--out', type=Path, default=Path('output/publish'))
    parser.add_argument('--gh', default='gh')
    args = parser.parse_args()
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', args.version), 'Use a stable numeric version')
    require(re.fullmatch(r'[0-9]+', args.ci_run), 'Use a numeric CI run ID')
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    def gh(*arguments):
        return subprocess.check_output([args.gh, *arguments], text=True, encoding='utf-8')

    run = json.loads(gh('run', 'view', args.ci_run, '--repo', REPO, '--json',
        'status,conclusion,name,headSha,jobs,url'))
    metadata = json.loads(gh('api', f'repos/{REPO}/actions/runs/{args.ci_run}'))
    require(metadata['path'] == '.github/workflows/ci.yml', 'Unexpected CI workflow')
    run['headRepository'] = {'nameWithOwner': metadata['head_repository']['full_name']}
    tag = 'v' + args.version
    release = json.loads(gh('api', f'repos/{REPO}/releases/tags/{tag}'))
    ref = json.loads(gh('api', f'repos/{REPO}/git/ref/tags/{tag}'))['object']
    require(ref['type'] == 'tag', 'Require an annotated release tag')
    if ref['type'] == 'tag':
        ref = json.loads(gh('api', f'repos/{REPO}/git/tags/{ref["sha"]}'))['object']
    require(ref['type'] == 'commit', 'Tag must resolve to a commit')
    with tempfile.TemporaryDirectory(prefix='fullbleed-publish-') as scratch:
        scratch = Path(scratch)
        ci = scratch / 'ci'
        public = scratch / 'public'
        gh('run', 'download', args.ci_run, '--repo', REPO, '--name', 'node-package', '--dir', str(ci))
        gh('release', 'download', tag, '--repo', REPO, '--pattern', '*.tgz',
           '--pattern', 'package-info.json', '--pattern', 'release-verification.json', '--dir', str(public))
        report = json.loads((public / 'release-verification.json').read_text())
        info = json.loads((ci / 'package-info.json').read_text())
        verify_binding(args.version, args.ci_run, run, release, ref['sha'], report)
        require(info == json.loads((public / 'package-info.json').read_text()), 'Package metadata differs from CI')
        filename = f'fullbleed-{args.version}.tgz'
        data = (ci / filename).read_bytes()
        require(data == (public / filename).read_bytes(), 'GitHub release bytes differ from CI')
        sha = verify_tarball(data, info, report)
        (out / filename).write_bytes(data)
    result = dict(ok=True, version=args.version, source_commit=run['headSha'], ci_run=args.ci_run,
        release=release['html_url'], filename=filename, sha256=sha, integrity=info['integrity'],
        bytes=len(data), scope=f'Exact public GitHub release tarball matched to all {len(run["jobs"])} successful CI jobs.')
    (out / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'filename={filename}\nsha256={sha}\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
