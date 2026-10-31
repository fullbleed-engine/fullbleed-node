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
CLOUDFLARE_SOURCE = ENGINE_REGRESSION_SOURCE.parents[1] / 'cloudflare/cases.mjs'
CLOUDFLARE_STARTER_SOURCE = Path(__file__).resolve().parents[1] / 'examples/cloudflare/test/fixtures.mjs'
PAGINATION_SOURCE = ENGINE_REGRESSION_SOURCE.parents[1] / 'pagination-fixtures.mjs'
TABLE_WRAPPING_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('table-wrapping-2.5.37.json')
GENERATED_QUOTES_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('generated-quotes-2.5.38.json')
TEXT_DECORATIONS_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('text-decorations-2.5.40.json')
TEXT_DECORATIONS_EXPECTATIONS = ENGINE_REGRESSION_SOURCE.with_name('text-decoration-expectations-2.5.40.json')
PREFORMATTED_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('preformatted-whitespace-2.5.41.json')
RADIAL_GRADIENT_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('radial-gradient-endpoints-2.5.43.json')
NAMED_FONT_SOURCE = ENGINE_REGRESSION_SOURCE.parents[1] / 'named-fonts.test.mjs'
NAMED_FONT_FILE = ENGINE_REGRESSION_SOURCE.parents[1] / 'fonts/family/LibreCaslonText[wght].ttf'
BATCH_SOURCE = ENGINE_REGRESSION_SOURCE.parents[1] / 'batch-fixtures.mjs'
PAGE_MARGIN_SOURCE = ENGINE_REGRESSION_SOURCE.with_name('page-margin-fonts-2.5.48.json')
PAGE_MARGIN_NATIVE = ENGINE_REGRESSION_SOURCE.with_name('page-margin-native-2.5.48.json')


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
    require(report.get('engine_version') in {fixture['engineVersion'], '2.5.46', '2.5.48'}, 'Paint fixtures target another engine')
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


def verify_cloudflare_evidence(report):
    release_version = tuple(map(int, report['package_version'].split('.')))
    worker_documents = 16 if release_version >= (0, 9, 0) else 8 if release_version >= (0, 8, 5) else 7
    for key, source, documents in [('cloudflare_workers', CLOUDFLARE_SOURCE, worker_documents),
                                   ('cloudflare_starter', CLOUDFLARE_STARTER_SOURCE, 6)]:
        source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        evidence = report.get(key, [])
        errors = 15 if key == 'cloudflare_workers' and release_version >= (0, 9, 0) else 10
        require(len(evidence) == 2 and {item.get('platform') for item in evidence} == {'win32', 'linux'},
                'Workers evidence requires Windows and Linux local runtime checks')
        require(all(item.get('ok') is True and item.get('package_version') == report['package_version']
                    and item.get('engine_version') == report['engine_version']
                    and item.get('tarball_sha256') == report['package_sha256']
                    and item.get('source_sha256') == source_sha and item.get('documents') == documents
                    and item.get('error_cases') == errors and item.get('node_bytes_identical') is True
                    and item.get('recovery') is True and item.get('server_stopped') is True
                    and item.get('independent_reader') is True and item.get('local_only') is True
                    and item.get('hosted_verified') is False and item.get('free_plan_verified') is False
                    and item.get('wrangler') and item.get('workerd') for item in evidence),
                'Workers evidence is incomplete or targets another package, tarball, source or scope')
        if key == 'cloudflare_workers':
            require(all(item.get('synchronous_instantiation') is True
                        and item.get('no_runtime_fetching_or_compilation') is True for item in evidence),
                    'Workers runtime boundary checks are incomplete')
        else:
            require(all(item.get('standalone_config') is True and item.get('input_tests') == 5 for item in evidence),
                    'Workers starter checks are incomplete')


def verify_named_font_evidence(report):
    require(report.get('named_font_source_sha256') == hashlib.sha256(NAMED_FONT_SOURCE.read_bytes()).hexdigest(),
            'Named font evidence targets another source')
    expected_font = hashlib.sha256(NAMED_FONT_FILE.read_bytes()).hexdigest()
    expected_cases = {(entry, isolation) for entry in ['esm', 'cjs'] for isolation in ['worker', 'process']}
    installed = report.get('installed_matrix', [])
    require(len(installed) == 9, 'Named fonts require the full installed matrix')
    outputs = set()
    for item in installed:
        evidence = item.get('named_fonts', {})
        cases = evidence.get('records', [])
        require(evidence.get('ok') is True and evidence.get('fontSha256') == expected_font
                and len(cases) == 4 and {(r.get('entry'), r.get('isolation')) for r in cases} == expected_cases,
                'Named font entrypoint/isolation or input evidence is incomplete')
        for case in cases:
            require(all(re.fullmatch(r'[0-9a-f]{64}', case.get(key, '')) for key in ['pdf', 'png']),
                    'Named font output hashes are missing')
            outputs.add((case['pdf'], case['png']))
    require(len(outputs) == 1, 'Named font outputs differ across the installed matrix')
    browsers = report.get('browser_matrix', [])
    require(len(browsers) == 3 and {b.get('browser') for b in browsers} == {'chrome', 'firefox', 'webkit'}
            and all(b.get('named_font_ok') is True for b in browsers), 'Named font browser checks are incomplete')


def verify_pagination_evidence(report):
    source_sha = hashlib.sha256(PAGINATION_SOURCE.read_bytes()).hexdigest()
    evidence = report.get('pagination', [])
    require(len(evidence) == 2 and {item.get('platform') for item in evidence} == {'win32', 'linux'},
            'Pagination inspection requires Windows and Linux evidence')
    require(all(item.get('ok') is True and item.get('package_version') == report['package_version']
                and item.get('engine_version') == report['engine_version']
                and item.get('tarball_sha256') == report['package_sha256']
                and item.get('source_sha256') == source_sha and item.get('negative_control') is False
                and item.get('cases') == 18 and item.get('passed') == 18 and item.get('failed') == 0
                for item in evidence),
            'Pagination evidence is incomplete or targets another package, tarball, source or negative control')
    browsers = report.get('browser_matrix', [])
    require(len(browsers) == 3 and {item.get('browser') for item in browsers} == {'chrome', 'firefox', 'webkit'},
            'Pagination inspection requires all three browser downloads')
    require(all(item.get('pagination_ok') is True and item.get('pagination_cases') == 9
                and item.get('pagination_source_sha256') == source_sha
                and item.get('pagination_passed') == 9 and item.get('pagination_failed') == 0
                and item.get('pagination_negative_control') is False for item in browsers),
            'Browser pagination evidence is incomplete or targets another source')
    controls = report.get('pagination_negative_controls', [])
    require(len(controls) == 1 and controls[0].get('platform') == 'linux'
                and controls[0].get('ok') is True and controls[0].get('negative_control') is True
                and controls[0].get('package_version') == '0.8.0' and controls[0].get('engine_version') == '2.5.29'
                and controls[0].get('source_sha256') == source_sha and controls[0].get('cases') == 18
                and controls[0].get('passed') == 2 and controls[0].get('failed') == 16,
            'Pagination public failure control is missing or was not calibrated')


def verify_table_wrapping_evidence(report):
    source_sha = hashlib.sha256(TABLE_WRAPPING_SOURCE.read_bytes()).hexdigest()
    fixture = json.loads(TABLE_WRAPPING_SOURCE.read_bytes())
    names = sorted(case['name'] for case in fixture['cases'])
    failing_names = sorted(case['name'] for case in fixture['cases'] if case['public081Fails'])
    evidence = report.get('table_wrapping', [])
    require(len(evidence) == 2 and {item.get('platform') for item in evidence} == {'win32', 'linux'},
            'Table wrapping requires Windows and Linux evidence')
    require(all(item.get('ok') is True and item.get('package_version') == report['package_version']
                and item.get('engine_version') == report['engine_version']
                and item.get('tarball_sha256') == report['package_sha256']
                and item.get('source_sha256') == source_sha and item.get('negative_control') is False
                and item.get('cases') == 70 and item.get('passed') == 70 and item.get('failed') == 0
                and item.get('case_names') == names for item in evidence),
            'Table wrapping evidence is incomplete or targets another package, source or tarball')
    require(next(item for item in evidence if item['platform'] == 'linux').get('unchanged_controls') == 34,
            'Table wrapping healthy controls must preserve their output')
    browsers = report.get('browser_matrix', [])
    require(len(browsers) == 3 and {item.get('browser') for item in browsers} == {'chrome', 'firefox', 'webkit'},
            'Table wrapping requires all three browser downloads')
    require(all(item.get('table_wrapping_ok') is True and item.get('table_wrapping_cases') == 35
                and item.get('table_wrapping_source_sha256') == source_sha
                and item.get('table_wrapping_passed') == 35 and item.get('table_wrapping_failed') == 0
                and item.get('table_wrapping_negative_control') is False for item in browsers),
            'Browser table wrapping evidence is incomplete or targets another source')
    controls = report.get('table_wrapping_negative_controls', [])
    require(len(controls) == 1 and controls[0].get('platform') == 'linux'
                and controls[0].get('ok') is True and controls[0].get('negative_control') is True
                and controls[0].get('package_version') == '0.8.1' and controls[0].get('engine_version') == '2.5.35'
                and controls[0].get('source_sha256') == source_sha and controls[0].get('cases') == 70
                and controls[0].get('passed') == 34 and controls[0].get('failed') == 36
                and controls[0].get('failed_case_names') == failing_names,
            'Table wrapping public failure control is missing or was not calibrated')


def verify_generated_quotes_evidence(report):
    source_sha = hashlib.sha256(GENERATED_QUOTES_SOURCE.read_bytes()).hexdigest()
    fixtures = json.loads(GENERATED_QUOTES_SOURCE.read_bytes())['cases']
    names = sorted(case['name'] for case in fixtures)
    failures = sorted(case['name'] for case in fixtures if case['previousEngineFails'])
    evidence = report.get('generated_quotes', [])
    require(len(evidence) == 2 and {row.get('platform') for row in evidence} == {'linux', 'win32'},
            'Generated quotations require Windows and Linux evidence')
    require(all(row.get('ok') is True and row.get('package_version') == report['package_version']
                and row.get('engine_version') == report['engine_version']
                and row.get('tarball_sha256') == report['package_sha256']
                and row.get('source_sha256') == source_sha and row.get('negative_control') is False
                and row.get('cases') == 82 and row.get('passed') == 82 and row.get('failed') == 0
                and row.get('case_names') == names for row in evidence),
            'Generated quotations evidence targets incomplete cases or another package, source or tarball')
    require(next(row for row in evidence if row['platform'] == 'linux').get('unchanged_controls') == 32,
            'Generated quotations healthy controls must preserve their output')
    browsers = report.get('browser_matrix', [])
    require(len(browsers) == 3 and {row.get('browser') for row in browsers} == {'chrome', 'firefox', 'webkit'},
            'Generated quotations require all three browser downloads')
    require(all(row.get('generated_quotes_ok') is True and row.get('generated_quotes_cases') == 41
                and row.get('generated_quotes_passed') == 41 and row.get('generated_quotes_failed') == 0
                and row.get('generated_quotes_source_sha256') == source_sha
                and row.get('generated_quotes_case_names') == names
                and row.get('generated_quotes_negative_control') is False for row in browsers),
            'Browser generated quotations evidence is incomplete or targets another source')
    controls = report.get('generated_quotes_negative_controls', [])
    require(len(controls) == 1 and controls[0].get('platform') == 'linux'
                and controls[0].get('ok') is True and controls[0].get('negative_control') is True
                and controls[0].get('package_version') == '0.8.2' and controls[0].get('engine_version') == '2.5.37'
                and controls[0].get('source_sha256') == source_sha and controls[0].get('cases') == 82
                and controls[0].get('passed') == 32 and controls[0].get('failed') == 50
                and controls[0].get('failed_case_names') == failures,
            'Generated quotations public failure control is missing or was not calibrated')


def verify_text_decorations_evidence(report):
    source_sha = hashlib.sha256(TEXT_DECORATIONS_SOURCE.read_bytes()).hexdigest()
    expectations_sha = hashlib.sha256(TEXT_DECORATIONS_EXPECTATIONS.read_bytes()).hexdigest()
    oracle = json.loads(TEXT_DECORATIONS_EXPECTATIONS.read_bytes())
    require(oracle['inputSha256'] == source_sha and oracle['engineVersion'] == '2.5.40'
                and report.get('engine_version') in {'2.5.40', '2.5.41', '2.5.43', '2.5.46', '2.5.48'},
            'Text decorations target another core or fixture')
    names = sorted(row['name'] for row in oracle['cases'])
    failing_names = sorted(row['name'] for row in oracle['cases'] if row['previousEngineFails'])
    require(len(names) == len(set(names)) == 16 and len(failing_names) == 13,
            'Text decorations require the complete calibrated fixture set')
    evidence = report.get('text_decorations', [])
    require(len(evidence) == 2 and {row.get('platform') for row in evidence} == {'linux', 'win32'},
            'Text decorations require Windows and Linux evidence')
    require(all(row.get('ok') is True and row.get('package_version') == report['package_version']
                and row.get('engine_version') == report['engine_version']
                and row.get('tarball_sha256') == report['package_sha256']
                and row.get('source_sha256') == source_sha and row.get('expectations_sha256') == expectations_sha
                and row.get('negative_control') is False and row.get('cases') == 32
                and row.get('passed') == 32 and row.get('failed') == 0
                and row.get('glyph_geometry_cases') == 32 and row.get('case_names') == names for row in evidence),
            'Text decorations evidence is incomplete or targets another package, source, oracle or tarball')
    require(next(row for row in evidence if row['platform'] == 'linux').get('unchanged_controls') == 6,
            'Text decorations healthy controls must preserve their output')
    browsers = report.get('browser_matrix', [])
    require(len(browsers) == 3 and {row.get('browser') for row in browsers} == {'chrome', 'firefox', 'webkit'},
            'Text decorations require all three browser downloads')
    require(all(row.get('text_decorations_ok') is True and row.get('text_decorations_cases') == 16
                and row.get('text_decorations_passed') == 16 and row.get('text_decorations_failed') == 0
                and row.get('text_decorations_glyph_geometry_cases') == 16
                and row.get('text_decorations_source_sha256') == source_sha
                and row.get('text_decorations_expectations_sha256') == expectations_sha
                and row.get('text_decorations_case_names') == names
                and row.get('text_decorations_negative_control') is False for row in browsers),
            'Browser text decorations evidence is incomplete or targets another source or oracle')
    controls = report.get('text_decorations_negative_controls', [])
    require(len(controls) == 1 and controls[0].get('platform') == 'linux'
                and controls[0].get('ok') is True and controls[0].get('negative_control') is True
                and controls[0].get('package_version') == '0.8.3' and controls[0].get('engine_version') == '2.5.38'
                and controls[0].get('source_sha256') == source_sha and controls[0].get('expectations_sha256') == expectations_sha
                and controls[0].get('cases') == 32 and controls[0].get('passed') == 6 and controls[0].get('failed') == 26
                and controls[0].get('glyph_geometry_cases') == 32 and controls[0].get('failed_case_names') == failing_names,
            'Text decorations public failure control is missing or was not calibrated')
    native = {row.get('name'): row for row in report.get('native_wasi_fixtures', [])}
    required = {'text-decorations-' + name for name in names}
    require(len(native) == len(report.get('native_wasi_fixtures', [])) and required.issubset(native)
                and all(native[name].get('nativeWasiPdfEqual') is True and native[name].get('nativeWasiPreviewsEqual') is True
                        for name in required), 'Text decorations native/WASI comparison is incomplete or duplicated')


def verify_preformatted_evidence(report):
    source = PREFORMATTED_SOURCE.read_bytes()
    source_sha = hashlib.sha256(source).hexdigest()
    fixtures = json.loads(source)['cases']
    names = sorted(row['name'] for row in fixtures)
    failures = sorted(row['name'] for row in fixtures if row['kind'] == 'wrap'
                      or (row['kind'] == 'whitespace' and not row['preserveIndent']))
    require(len(names) == len(set(names)) == 17 and len(failures) == 10,
            'Preformatted inspection requires the complete calibrated fixture set')
    evidence = report.get('preformatted_whitespace', [])
    require(len(evidence) == 2 and {row.get('platform') for row in evidence} == {'linux', 'win32'},
            'Preformatted inspection requires Windows and Linux package evidence')
    require(all(row.get('ok') is True and row.get('package_version') == report['package_version']
                and row.get('engine_version') == report['engine_version']
                and row.get('tarball_sha256') == report['package_sha256']
                and row.get('source_sha256') == source_sha and row.get('negative_control') is False
                and row.get('cases') == 34 and row.get('passed') == 34 and row.get('failed') == 0
                and row.get('case_names') == names and row.get('failed_case_names') == [] for row in evidence),
            'Preformatted evidence is incomplete or targets another package, engine, tarball or input')
    require(next(row for row in evidence if row['platform'] == 'linux').get('unchanged_controls') == 14,
            'Preformatted preservation controls must retain their output')
    controls = report.get('preformatted_negative_controls', [])
    require(len(controls) == 1 and controls[0].get('platform') == 'linux'
                and controls[0].get('ok') is True and controls[0].get('negative_control') is True
                and controls[0].get('package_version') == '0.8.5' and controls[0].get('engine_version') == '2.5.40'
                and controls[0].get('source_sha256') == source_sha and controls[0].get('cases') == 34
                and controls[0].get('passed') == 14 and controls[0].get('failed') == 20
                and controls[0].get('case_names') == names and controls[0].get('failed_case_names') == failures,
            'Preformatted public-package negative control is missing or uncalibrated')


def verify_radial_gradient_evidence(report):
    source = RADIAL_GRADIENT_SOURCE.read_bytes()
    fixtures = json.loads(source)['cases']
    source_sha = hashlib.sha256(source).hexdigest()
    names = sorted(row['name'] for row in fixtures)
    failures = sorted(row['name'] for row in fixtures if row['affected'])
    keys = sorted(mode + ':' + name for mode in ('worker', 'process') for name in names)
    require(len(names) == len(set(names)) == 12 and len(failures) == 9,
            'Radial-gradient fixture set changed without calibration')
    evidence = report.get('radial_gradients', [])
    require(len(evidence) == 2 and {row.get('platform') for row in evidence} == {'linux', 'win32'},
            'Radial gradients require separate Linux and Windows installed-package evidence')
    require(report.get('engine_version') in {'2.5.43', '2.5.46', '2.5.48'}, 'Radial evidence targets another engine')
    for row in evidence:
        require(row.get('ok') is True and row.get('negative_control') is False
                and row.get('package_version') == report.get('package_version')
                and row.get('engine_version') == report.get('engine_version')
                and row.get('tarball_sha256') == report.get('package_sha256')
                and row.get('wasm_sha256') == report.get('wasm_sha256')
                and row.get('source_sha256') == source_sha,
                'Radial evidence targets another source, package, engine, or WASM artifact')
        require(row.get('cases') == row.get('passing_color_cases') == row.get('core_matching_cases') == 24
                and row.get('failing_color_cases') == row.get('invalid_stitching_cases') == 0
                and row.get('case_names') == names and row.get('case_keys') == keys
                and row.get('failed_case_names') == [],
                'Radial output is incomplete, duplicated, has wrong colors, invalid stitching, or differs from the qualified core')
    linux = next(row for row in evidence if row['platform'] == 'linux')
    require(linux.get('unchanged_controls') == 4, 'Radial preservation controls are missing')
    baseline = report.get('radial_gradients_negative_control', {})
    require(baseline.get('ok') is True and baseline.get('negative_control') is True
            and baseline.get('package_version') == '0.8.6' and baseline.get('engine_version') == '2.5.41'
            and baseline.get('source_sha256') == source_sha and baseline.get('cases') == 24
            and baseline.get('passing_color_cases') == 6 and baseline.get('failing_color_cases') == 18
            and baseline.get('invalid_stitching_cases') == 20 and baseline.get('core_matching_cases') == 4
            and baseline.get('case_names') == names and baseline.get('case_keys') == keys
            and baseline.get('failed_case_names') == failures,
            'Actual public 0.8.6 radial-gradient failure control is absent or uncalibrated')


def verify_batch_evidence(report):
    expected_pages = {'batch-fixed': 2, 'batch-reflow': 5, 'batch-missing': 2, 'batch-components': 2,
                      'batch-literal': 1, 'batch-fallback-fixed': 2, 'batch-fallback-reflow': 2}
    require(report.get('batch_source_sha256') == hashlib.sha256(BATCH_SOURCE.read_bytes()).hexdigest(),
            'Batch evidence targets another fixture source')
    installed = report.get('installed_matrix', [])
    require(len(installed) == 9, 'Batch rendering requires all nine installed-package jobs')
    for item in installed:
        batch = item.get('batch_smoke', {})
        require(batch.get('ok') is True and batch.get('queueClosed') is True and batch.get('tests', 0) >= 28
                and batch.get('packageVersion') == report['package_version']
                and batch.get('engineVersion') == report['engine_version']
                and item.get('tarball_sha256') == report['package_sha256'],
                'Installed batch lifecycle evidence is incomplete or targets another package')
        fixtures = batch.get('fixtures', [])
        require(len(fixtures) == 7 and {row.get('name') for row in fixtures} == set(expected_pages),
                'Installed batch cases are missing or duplicated')
        require(all(row.get('pages') == expected_pages[row['name']] and row.get('cjsProcessAndQueueEqual') is True
                    and re.fullmatch(r'[a-f0-9]{64}', row.get('pdf', '')) for row in fixtures),
                'Batch output or CommonJS/process/queue comparison is incomplete')
        examples = batch.get('readmeExamples', [])
        require(len(examples) == 2 and {row.get('name'): row.get('pages') for row in examples}
                    == {'readme-batch-1': 2, 'readme-batch-2': 1}
                and all(re.fullmatch(r'[a-f0-9]{64}', row.get('unmodifiedExampleSha256', '')) for row in examples),
                'Both actual installed README batch examples must run')
    readers = report.get('batch_readers', [])
    require(len(readers) == 2 and {row.get('platform') for row in readers} == {'linux', 'win32'},
            'Batch PDFs require separate Linux and Windows independent-reader evidence')
    require(all(row.get('ok') is True and row.get('package_version') == report['package_version']
                and row.get('engine_version') == report['engine_version'] and row.get('tarball_sha256') == report['package_sha256']
                and row.get('source_sha256') == report['batch_source_sha256'] and row.get('documents') == 9 and row.get('pages') == 19
                and row.get('record_ranges_verified') is True and row.get('glyph_reports_verified') is True for row in readers),
            'Independent batch text, range or character evidence is incomplete')
    browsers = report.get('browser_matrix', [])
    require(len(browsers) == 3 and {row.get('browser') for row in browsers} == {'chrome', 'firefox', 'webkit'},
            'Batch rendering requires all three browser download checks')
    require(all(row.get('batch_cases') == 7 and row.get('batch_source_sha256') == report['batch_source_sha256']
                and row.get('batch_reports_equal') is True and row.get('batch_records_snapshot') is True
                and row.get('batch_failure_recovery') is True for row in browsers),
            'Browser batch reports, snapshots or failure recovery are incomplete')
    native_rows = [row for row in report.get('native_wasi_fixtures', []) if row.get('batch')]
    require(len(native_rows) == 7 and {row.get('name') for row in native_rows} == set(expected_pages)
            and all(row.get('pages') == expected_pages[row['name']] and row.get('nativeWasiReportsEqual') is True
                    and row.get('nativeWasiPdfEqual') is True and row.get('nativeWasiPreviewsEqual') is True for row in native_rows),
            'Native/WASI batch PDF, preview or record-report evidence is incomplete')


def verify_page_margin_evidence(report):
    source = PAGE_MARGIN_SOURCE.read_bytes()
    source_sha = hashlib.sha256(source).hexdigest()
    native_bytes = PAGE_MARGIN_NATIVE.read_bytes()
    native_sha = hashlib.sha256(native_bytes).hexdigest()
    native = json.loads(native_bytes)
    names = {case['name'] for case in json.loads(source)['cases']}
    require(native['fixtureSha256'] == source_sha and report.get('engine_version') == native['engineVersion'],
            'Page-margin fixtures target another source or engine')
    evidence = report.get('page_margin_fonts', [])
    require(len(evidence) == 2 and {row.get('platform') for row in evidence} == {'linux', 'win32'},
            'Page-margin PDFs require Windows and Linux evidence')
    expected = {case['name']: case for case in native['cases']}
    for row in evidence:
        require(row.get('ok') is True and row.get('negativeControl') is False and row.get('isolation') == 'process'
                and row.get('defaultStyles') is False
                and row.get('packageVersion') == report['package_version']
                and row.get('engineVersion') == report['engine_version']
                and row.get('tarballSha256') == report['package_sha256']
                and row.get('wasmSha256') == report['wasm_sha256']
                and row.get('fixtureSha256') == source_sha and row.get('nativeReferenceSha256') == native_sha
                and row.get('pairs') == 8 and row.get('pages') == 18 and row.get('nativeMatchingDocuments') == 16,
                'Page-margin evidence is incomplete or targets another package')
        cases = row.get('cases', [])
        require(len(cases) == 8 and {case.get('name') for case in cases} == names,
                'Page-margin cases are missing or duplicated')
        for case in cases:
            require(case.get('mismatches') == [], 'An alias differs from its explicit-face control')
            for kind in ['alias', 'control']:
                actual = case.get(kind, {})
                require(actual.get('problems') == [] and all(actual.get(key) == expected[case['name']][kind][key]
                        for key in ['pdfSha256', 'pages', 'nativePreviewSha256', 'pdfiumPixelsSha256']),
                        'Page-margin PDF, font, text or preview differs from the qualified native control')
    negative = report.get('page_margin_negative_control', {})
    require(negative.get('ok') is True and negative.get('negativeControl') is True
            and negative.get('defaultStyles') is False
            and negative.get('publicFailureReproduced') is True and negative.get('packageVersion') == '0.9.0'
            and negative.get('engineVersion') == '2.5.46' and negative.get('fixtureSha256') == source_sha,
            'The actual public page-margin failure control is missing')
    failed = {case['name']: case for case in negative.get('cases', [])}
    for name in ['local-alias', 'url-alias']:
        case = failed.get(name, {})
        require(case.get('control', {}).get('problems') == [] and bool(case.get('mismatches'))
                and any(problem.get('field') == 'footerFont' for problem in case.get('alias', {}).get('problems', [])),
                'Page-margin failure control is uncalibrated')


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
                require(report.get('engine_version') in {hidden_fixture['engineVersion'], '2.5.46', '2.5.48'},
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
        if release_version >= (0, 8, 0):
            verify_cloudflare_evidence(report)
        if release_version >= (0, 8, 1):
            verify_pagination_evidence(report)
        if release_version >= (0, 8, 2):
            verify_table_wrapping_evidence(report)
        if release_version >= (0, 8, 3):
            verify_generated_quotes_evidence(report)
        if release_version >= (0, 8, 4):
            verify_text_decorations_evidence(report)
        if release_version >= (0, 8, 5):
            verify_named_font_evidence(report)
        if release_version >= (0, 8, 6):
            verify_preformatted_evidence(report)
        if release_version >= (0, 8, 7):
            verify_radial_gradient_evidence(report)
        if release_version >= (0, 9, 0):
            verify_batch_evidence(report)
        if release_version >= (0, 9, 1):
            verify_page_margin_evidence(report)


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
        if tuple(map(int, info['version'].split('.'))) >= (0, 8, 7):
            wasm_sha = hashlib.sha256(archive.extractfile('package/dist/engine.wasm').read()).hexdigest()
            build = json.load(archive.extractfile('package/dist/build.json'))
            require(wasm_sha == build['files']['dist/engine.wasm']['sha256'] == report.get('wasm_sha256'),
                    'Radial evidence does not identify the actual packaged WASM bytes')
    require(all(item['tarball_sha256'] == sha for item in report['installed_matrix']), 'Matrix tested another tarball')
    if tuple(map(int, info['version'].split('.'))) >= (0, 3, 0):
        require({'dist/browser/client.js', 'dist/browser/worker.js', 'dist/browser/asset-manifest.json', 'src/browser.d.ts', 'src/copy-browser-assets.cjs'}.issubset(names),
                'Browser package files are missing')
        require(all(item['tarball_sha256'] == sha for item in report['browser_matrix']), 'Browser matrix tested another tarball')
    if tuple(map(int, info['version'].split('.'))) >= (0, 6, 0):
        require({'src/ui.js', 'src/ui.cjs', 'src/ui.d.ts', 'dist/ui.js', 'dist/ui.d.cts',
                 'src/jsx-runtime.js', 'src/jsx-runtime.cjs', 'src/jsx-runtime.d.ts',
                 'dist/jsx-runtime.js', 'dist/jsx-runtime.d.cts'}.issubset(names), 'Component/JSX package files are missing')
    if tuple(map(int, info['version'].split('.'))) >= (0, 8, 0):
        require({'dist/cloudflare.js', 'src/cloudflare.d.ts'}.issubset(names), 'Workers package files are missing')
    if tuple(map(int, info['version'].split('.'))) >= (0, 9, 0):
        require({'src/batch-report.cjs', 'src/batch.d.ts', 'dist/batch.d.cts'}.issubset(names), 'Batch runtime or type files are missing')
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
