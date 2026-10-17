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
ENGINE_REGRESSION_SOURCE = Path(__file__).resolve().parents[1] / 'test/fixtures/engine-2.5.22.json'
DECORATION_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('decoration-thickness.json')
HIDDEN_TEXT_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('hidden-text-2.5.24.json')
COMPONENT_SOURCE = ENGINE_REGRESSION_SOURCE.parents[1] / 'component-cases.mjs'
HTML_EXPORT_SOURCE = Path(__file__).resolve().parent / 'html-export-fixtures.mjs'
ENGINE_PAINT_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('engine-paint-2.5.28.json')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_component_evidence(report):
    source_sha = hashlib.sha256(COMPONENT_SOURCE.read_bytes()).hexdigest()
    inspections = report.get('component_authoring', [])
    require(len(inspections) == 2 and {item.get('platform') for item in inspections} == {'win32', 'linux'},
            'Component PDF inspection requires Windows and Linux evidence')
    require(all(item.get('ok') is True and item.get('package_version') == report['package_version']
                and item.get('engine_version') == report['engine_version']
                and item.get('tarball_sha256') == report['package_sha256'] and item.get('source_sha256') == source_sha
                and item.get('documents') == 7 and item.get('pages') == 13 for item in inspections),
            'Component PDF evidence is incomplete or targets another package, source or tarball')
    require(all(item.get('component_documents') == 7 and item.get('component_pages') == 13
                and item.get('component_jsx_equal') is True and item.get('component_recovery') is True
                for item in report['installed_matrix']), 'Installed component/JSX or recovery evidence is incomplete')
    require(all(item.get('component_cases') == 7 and item.get('component_editor_download') is True
                and item.get('component_source_sha256') == source_sha for item in report['browser_matrix']),
            'Browser component/JSX or editor download evidence is incomplete')


def verify_html_export_evidence(report):
    source_sha = hashlib.sha256(HTML_EXPORT_SOURCE.read_bytes()).hexdigest()
    browsers = report.get('html_export', [])
    require(len(browsers) == 3 and {item.get('browser') for item in browsers} == {'chrome', 'firefox', 'webkit'},
            'Static HTML export requires all three browser checks')
    require(all(item.get('ok') is True and item.get('package_version') == report['package_version']
                and item.get('tarball_sha256') == report['package_sha256'] and item.get('source_sha256') == source_sha
                and item.get('documents') == 8 and item.get('checks', 0) >= 48 for item in browsers),
            'Static HTML export evidence is incomplete or targets another package, source or tarball')
    installed = report.get('installed_matrix', [])
    require(len(installed) == 9 and all(item.get('component_html_exports_equal') is True
                and item.get('html_export_fixtures') == 8 for item in installed),
            'Installed styled and unstyled HTML evidence is incomplete')


def verify_engine_paint_evidence(report):
    source = ENGINE_PAINT_SOURCE.read_bytes()
    fixture = json.loads(source)
    source_sha = hashlib.sha256(source).hexdigest()
    names = {case['name'] for case in fixture['cases']}
    families = {case['family'] for case in fixture['cases']}
    require(report.get('engine_version') == fixture['engineVersion'], 'Paint fixtures target another engine')
    evidence = report.get('engine_paint', [])
    require(len(evidence) == 2 and {item.get('platform') for item in evidence} == {'win32', 'linux'},
            'Paint inspection requires Windows and Linux evidence')
    require(all(item.get('ok') is True and item.get('package_version') == report['package_version']
                and item.get('engine_version') == report['engine_version']
                and item.get('tarball_sha256') == report['package_sha256']
                and item.get('source_sha256') == source_sha and item.get('negative_control') is False
                and item.get('cases') == 2*len(names) and set(item.get('families', [])) == families
                and item.get('case_names') == sorted(names) for item in evidence),
            'Paint inspection is incomplete or targets another package, tarball, source or negative control')
    browsers = report.get('browser_matrix', [])
    require(len(browsers) == 3 and {item.get('browser') for item in browsers} == {'chrome', 'firefox', 'webkit'},
            'Paint inspection requires all three browser downloads')
    require(all(item.get('paint_ok') is True and item.get('paint_cases') == len(names)
                and item.get('paint_source_sha256') == source_sha and item.get('paint_negative_control') is False
                for item in browsers), 'Browser paint inspection is incomplete or targets another source')
    native = {item.get('name'): item for item in report.get('native_wasi_fixtures', [])}
    require(len(native) == len(report.get('native_wasi_fixtures', [])) and names.issubset(native)
                and all(native[name].get('nativeWasiPdfEqual') is True and native[name].get('nativeWasiPreviewsEqual') is True
                        for name in names), 'Native/WASI paint comparison is incomplete or duplicated')


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
        release_version = tuple(map(int, version.split('.')))
        required_browser_checks = 816 if release_version >= (0, 5, 1) else 144 if release_version >= (0, 4, 1) else 105 if release_version >= (0, 3, 2) else 66 if release_version >= (0, 3, 1) else 30
        require(all(item.get('ok') is True and item.get('package_version') == version and item.get('checks', 0) >= required_browser_checks for item in browsers),
                'Browser verification is incomplete or tests another package')
        if release_version >= (0, 4, 0):
            require(all(item.get('queue_checks', 0) >= 14 and item.get('queue_peak_workers') == 2
                        for item in report['installed_matrix']),
                    'Installed queue verification is incomplete')
        if release_version >= (0, 4, 1):
            source = ENGINE_REGRESSION_SOURCE.read_bytes()
            source_sha = hashlib.sha256(source).hexdigest()
            cases = json.loads(source)['cases']
            if release_version >= (0, 5, 1):
                decoration = DECORATION_SOURCE.read_bytes()
                decoration_sha = hashlib.sha256(decoration).hexdigest()
                cases += json.loads(decoration)['cases']
            names = {case['name'] for case in cases}
            families = {case['family'] for case in cases}
            regressions = report.get('engine_regressions', [])
            require(len(regressions) == 2 and {item.get('platform') for item in regressions} == {'win32', 'linux'},
                    'Windows and Linux engine regression evidence is required')
            require(all(item.get('ok') is True and item.get('package_version') == version
                        and item.get('engine_version') == report.get('engine_version')
                        and item.get('source_sha256') == source_sha and item.get('cases') == 2 * len(names)
                        and set(item.get('families', [])) == families for item in regressions),
                    'Engine regression evidence is incomplete or targets another source')
            require(all(item.get('engine_regression_ok') is True and item.get('engine_regression_cases') == len(names)
                        and item.get('engine_regression_source_sha256') == source_sha for item in browsers),
                    'Browser engine regression evidence is incomplete')
            native = {item.get('name'): item for item in report.get('native_wasi_fixtures', [])}
            require(names.issubset(native) and all(native[name].get('nativeWasiPdfEqual') is True
                        and native[name].get('nativeWasiPreviewsEqual') is True for name in names),
                    'Native/WASI engine regression comparison is incomplete')
            if release_version >= (0, 5, 1):
                require(all(item.get('decoration_source_sha256') == decoration_sha
                            and item.get('tarball_sha256') == report.get('package_sha256')
                            and item.get('negative_control') is False for item in regressions),
                        'Decoration evidence targets another fixture, tarball, or negative control')
                require(all(item.get('decoration_source_sha256') == decoration_sha for item in browsers),
                        'Browser decoration evidence targets another fixture')
                hidden_source = HIDDEN_TEXT_SOURCE.read_bytes()
                hidden_sha = hashlib.sha256(hidden_source).hexdigest()
                hidden_fixture = json.loads(hidden_source)
                hidden_cases = hidden_fixture['cases']
                require(report.get('engine_version') == hidden_fixture['engineVersion'],
                        'Hidden-text fixtures target another engine')
                hidden = report.get('hidden_text', [])
                require(len(hidden) == 2 and {item.get('platform') for item in hidden} == {'win32', 'linux'},
                        'Windows and Linux hidden-text evidence is required')
                require(all(item.get('ok') is True and item.get('package_version') == version
                            and item.get('engine_version') == report.get('engine_version')
                            and item.get('source_sha256') == hidden_sha and item.get('cases') == 2 * len(hidden_cases)
                            and item.get('tarball_sha256') == report.get('package_sha256')
                            and item.get('negative_control') is False for item in hidden),
                        'Hidden-text evidence is incomplete or targets another input')
                require(all(item.get('hidden_text_ok') is True
                            and item.get('hidden_text_cases') == len(hidden_cases)
                            and item.get('hidden_text_source_sha256') == hidden_sha
                            and item.get('hidden_text_negative_control') is False for item in browsers),
                        'Browser hidden-text evidence is incomplete or targets another input')
                hidden_names = {f'visibility-{case["name"]}-{variant}' for case in hidden_cases
                                for variant in ('source', 'control')}
                require(len(native) == len(report['native_wasi_fixtures'])
                            and hidden_names.issubset(native)
                            and all(native[name].get('nativeWasiPdfEqual') is True
                                    and native[name].get('nativeWasiPreviewsEqual') is True for name in hidden_names),
                        'Native/WASI hidden-text comparison is incomplete or duplicated')
        if release_version >= (0, 6, 0):
            verify_component_evidence(report)
        if release_version >= (0, 7, 0):
            verify_html_export_evidence(report)
        if release_version >= (0, 7, 1):
            verify_engine_paint_evidence(report)


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
    if tuple(map(int, info['version'].split('.'))) >= (0, 6, 0):
        require({'src/ui.js', 'src/ui.cjs', 'src/ui.d.ts', 'dist/ui.js', 'dist/ui.d.cts',
                 'src/jsx-runtime.js', 'src/jsx-runtime.cjs', 'src/jsx-runtime.d.ts',
                 'dist/jsx-runtime.js', 'dist/jsx-runtime.d.cts'}.issubset(names), 'Component/JSX package files are missing')
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
