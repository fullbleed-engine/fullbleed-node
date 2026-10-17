# SPDX-License-Identifier: MIT
import importlib.util
import hashlib
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verify_release', Path(__file__).resolve().parents[1] / 'tools/verify-release.py')
release_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_check)


class ReleaseBindingTests(unittest.TestCase):
    def setUp(self):
        self.commit = 'a' * 40
        self.run = dict(status='completed', conclusion='success', name='Node integration',
            headRepository={'nameWithOwner': release_check.REPO}, headSha=self.commit,
            jobs=[{'conclusion': 'success'} for _ in range(10)])
        self.release = dict(draft=False, prerelease=False, tag_name='v0.1.2')
        self.report = dict(ok=True, package_version='0.1.2', source_commit=self.commit,
            ci_run=f'https://github.com/{release_check.REPO}/actions/runs/123', ci_jobs=10,
            installed_matrix=[{} for _ in range(9)])

    def verify(self, version='0.1.2', run_id='123', commit=None):
        release_check.verify_binding(version, run_id, self.run, self.release,
                                     commit or self.commit, self.report)

    def test_matching_successful_source_is_accepted(self):
        self.verify()

    def test_incomplete_or_failed_matrix_is_rejected(self):
        for conclusion in ['failure', 'skipped', 'cancelled', '']:
            with self.subTest(conclusion=conclusion):
                self.run['jobs'][4]['conclusion'] = conclusion
                with self.assertRaises(ValueError): self.verify()

    def test_source_mismatch_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Source commit'): self.verify(commit='b' * 40)
        self.report['source_commit'] = 'c' * 40
        with self.assertRaisesRegex(ValueError, 'Source commit'): self.verify()

    def test_other_repository_is_rejected(self):
        self.run['headRepository']['nameWithOwner'] = 'example/fork'
        with self.assertRaisesRegex(ValueError, 'repository'): self.verify()

    def test_unpublished_release_is_rejected(self):
        self.release['draft'] = True
        with self.assertRaisesRegex(ValueError, 'published stable'): self.verify()

    def test_wrong_run_or_injected_arguments_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'CI run differs'): self.verify(run_id='456')
        for version in ['../0.1.2', '0.1.2\nnext', '--help']:
            with self.subTest(version=version), self.assertRaises(ValueError): self.verify(version=version)

    def test_changed_tarball_is_rejected_before_archive_read(self):
        info = {'integrity': 'sha512-unused'}
        report = {'package_sha256': '0' * 64}
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            release_check.verify_tarball(b'modified tarball', info, report)

    def browser_release(self):
        names = ['Build published engine and verify native output']
        names += [f'Packed package ({os}, Node {node})' for os in ['ubuntu-latest', 'windows-latest', 'macos-latest'] for node in ['22', '24', '26']]
        names += [f'Browser package ({browser})' for browser in ['chrome', 'firefox', 'webkit']]
        self.run['jobs'] = [{'name': name, 'conclusion': 'success'} for name in names]
        self.release['tag_name'] = 'v0.3.0'
        self.report.update(package_version='0.3.0', ci_jobs=13,
            browser_matrix=[{'browser': browser, 'ok': True, 'package_version': '0.3.0', 'checks': 30} for browser in ['chrome', 'firefox', 'webkit']])

    def test_browser_release_requires_every_named_browser_job(self):
        self.browser_release()
        self.verify(version='0.3.0')
        self.run['jobs'][-1]['name'] = 'Unrelated green job'
        with self.assertRaisesRegex(ValueError, 'Required browser'): self.verify(version='0.3.0')

    def test_browser_release_rejects_incomplete_or_wrong_package_evidence(self):
        for change in [{'checks': 0}, {'ok': False}, {'package_version': '0.2.0'}, {'browser': 'chrome'}]:
            with self.subTest(change=change):
                self.browser_release()
                self.report['browser_matrix'][-1].update(change)
                with self.assertRaises(ValueError): self.verify(version='0.3.0')

    def test_inline_release_requires_the_expanded_browser_checks(self):
        self.browser_release()
        self.release['tag_name'] = 'v0.3.1'
        self.report['package_version'] = '0.3.1'
        for browser in self.report['browser_matrix']:
            browser.update(package_version='0.3.1', checks=66)
        self.verify(version='0.3.1')
        self.report['browser_matrix'][0]['checks'] = 30
        with self.assertRaisesRegex(ValueError, 'Browser verification is incomplete'):
            self.verify(version='0.3.1')

    def test_standard_font_release_requires_its_browser_cases(self):
        self.browser_release()
        self.release['tag_name'] = 'v0.3.2'
        self.report['package_version'] = '0.3.2'
        for browser in self.report['browser_matrix']:
            browser.update(package_version='0.3.2', checks=105)
        self.verify(version='0.3.2')
        self.report['browser_matrix'][0]['checks'] = 66
        with self.assertRaisesRegex(ValueError, 'Browser verification is incomplete'):
            self.verify(version='0.3.2')

    def test_queue_release_requires_installed_queue_evidence(self):
        self.browser_release()
        self.release['tag_name'] = 'v0.4.0'
        self.report['package_version'] = '0.4.0'
        for browser in self.report['browser_matrix']:
            browser.update(package_version='0.4.0', checks=105)
        for installed in self.report['installed_matrix']:
            installed.update(queue_checks=14, queue_peak_workers=2)
        self.verify(version='0.4.0')
        for change in [{'queue_checks': 13}, {'queue_peak_workers': 6}]:
            with self.subTest(change=change):
                self.report['installed_matrix'][0].update(queue_checks=14, queue_peak_workers=2)
                self.report['installed_matrix'][0].update(change)
                with self.assertRaisesRegex(ValueError, 'Installed queue verification'):
                    self.verify(version='0.4.0')

    def engine_release(self):
        self.browser_release()
        self.release['tag_name'] = 'v0.4.1'
        source = release_check.ENGINE_REGRESSION_SOURCE.read_bytes()
        cases = json.loads(source)['cases']
        source_sha = hashlib.sha256(source).hexdigest()
        self.report.update(package_version='0.4.1', engine_version='2.5.22',
            engine_regressions=[dict(platform=platform, ok=True, package_version='0.4.1', engine_version='2.5.22',
                source_sha256=source_sha, cases=2*len(cases), families=sorted({case['family'] for case in cases})) for platform in ['win32','linux']],
            native_wasi_fixtures=[dict(name=case['name'], nativeWasiPdfEqual=True, nativeWasiPreviewsEqual=True) for case in cases])
        for browser in self.report['browser_matrix']:
            browser.update(package_version='0.4.1', checks=144, engine_regression_ok=True,
                engine_regression_cases=len(cases), engine_regression_source_sha256=source_sha)
        for installed in self.report['installed_matrix']:
            installed.update(queue_checks=14, queue_peak_workers=2)

    def test_engine_release_requires_independent_windows_and_linux_evidence(self):
        self.engine_release()
        self.verify(version='0.4.1')
        for change in [{'ok':False}, {'cases':2}, {'source_sha256':'0'*64}, {'engine_version':'2.5.11'}, {'families':['counter']}, {'platform':'linux'}]:
            with self.subTest(change=change):
                self.engine_release()
                self.report['engine_regressions'][0].update(change)
                with self.assertRaisesRegex(ValueError, 'engine regression|Engine regression'):
                    self.verify(version='0.4.1')

    def test_engine_release_rejects_browser_or_native_evidence_gaps(self):
        for change in [{'engine_regression_ok':False}, {'engine_regression_cases':0}, {'engine_regression_source_sha256':'0'*64}]:
            with self.subTest(change=change):
                self.engine_release()
                self.report['browser_matrix'][0].update(change)
                with self.assertRaisesRegex(ValueError, 'Browser engine regression'):
                    self.verify(version='0.4.1')
        self.engine_release()
        self.report['native_wasi_fixtures'].pop()
        with self.assertRaisesRegex(ValueError, 'Native/WASI'):
            self.verify(version='0.4.1')
        self.engine_release()
        self.report['native_wasi_fixtures'][0]['nativeWasiPreviewsEqual'] = False
        with self.assertRaisesRegex(ValueError, 'Native/WASI'):
            self.verify(version='0.4.1')

    def hidden_text_release(self):
        self.engine_release()
        self.release['tag_name'] = 'v0.5.1'
        decoration = release_check.DECORATION_SOURCE.read_bytes()
        decoration_sha = hashlib.sha256(decoration).hexdigest()
        decoration_cases = json.loads(decoration)['cases']
        hidden = release_check.HIDDEN_TEXT_SOURCE.read_bytes()
        hidden_sha = hashlib.sha256(hidden).hexdigest()
        hidden_fixture = json.loads(hidden)
        engine = hidden_fixture['engineVersion']
        self.report.update(package_version='0.5.1', engine_version=engine, package_sha256='d' * 64)
        for item in self.report['engine_regressions']:
            item.update(package_version='0.5.1', engine_version=engine,
                cases=item['cases'] + 2 * len(decoration_cases),
                families=sorted(set(item['families']) | {'decoration'}),
                decoration_source_sha256=decoration_sha, tarball_sha256='d' * 64, negative_control=False)
        self.report['hidden_text'] = [dict(platform=platform, ok=True, package_version='0.5.1',
            engine_version=engine, source_sha256=hidden_sha, cases=2 * len(hidden_fixture['cases']),
            tarball_sha256='d' * 64, negative_control=False) for platform in ['win32', 'linux']]
        for browser in self.report['browser_matrix']:
            browser.update(package_version='0.5.1', checks=816,
                engine_regression_cases=browser['engine_regression_cases'] + len(decoration_cases),
                decoration_source_sha256=decoration_sha, hidden_text_ok=True,
                hidden_text_cases=len(hidden_fixture['cases']), hidden_text_source_sha256=hidden_sha,
                hidden_text_negative_control=False)
        names = [case['name'] for case in decoration_cases]
        names += [f'visibility-{case["name"]}-{variant}' for case in hidden_fixture['cases']
                  for variant in ['source', 'control']]
        self.report['native_wasi_fixtures'] += [dict(name=name, nativeWasiPdfEqual=True,
            nativeWasiPreviewsEqual=True) for name in names]

    def test_hidden_text_release_accepts_complete_current_evidence(self):
        self.hidden_text_release()
        self.verify(version='0.5.1')

    def test_hidden_text_release_rejects_missing_platform_or_wrong_evidence(self):
        for change in [{'ok': False}, {'cases': 94}, {'source_sha256': '0' * 64},
                       {'engine_version': '2.5.22'}, {'package_version': '0.5.0'},
                       {'tarball_sha256': '0' * 64}, {'negative_control': True}, {'platform': 'linux'}]:
            with self.subTest(change=change):
                self.hidden_text_release()
                self.report['hidden_text'][0].update(change)
                with self.assertRaisesRegex(ValueError, 'hidden-text|Hidden-text'):
                    self.verify(version='0.5.1')
        self.hidden_text_release()
        self.report['hidden_text'].pop()
        with self.assertRaisesRegex(ValueError, 'Windows and Linux hidden-text'):
            self.verify(version='0.5.1')

    def test_hidden_text_release_rejects_browser_or_native_gaps(self):
        for change in [{'hidden_text_ok': False}, {'hidden_text_cases': 0},
                       {'hidden_text_source_sha256': '0' * 64}, {'hidden_text_negative_control': True}]:
            with self.subTest(change=change):
                self.hidden_text_release()
                self.report['browser_matrix'][0].update(change)
                with self.assertRaisesRegex(ValueError, 'Browser hidden-text'):
                    self.verify(version='0.5.1')
        for mutation in ['missing', 'changed', 'duplicate']:
            with self.subTest(mutation=mutation):
                self.hidden_text_release()
                fixtures = self.report['native_wasi_fixtures']
                if mutation == 'missing': fixtures.pop()
                elif mutation == 'changed': fixtures[-1]['nativeWasiPreviewsEqual'] = False
                else: fixtures.append(dict(fixtures[-1]))
                with self.assertRaisesRegex(ValueError, 'Native/WASI hidden-text'):
                    self.verify(version='0.5.1')

    def test_hidden_text_release_rejects_stale_decoration_or_browser_coverage(self):
        for change in [{'decoration_source_sha256': '0' * 64}, {'tarball_sha256': '0' * 64},
                       {'negative_control': True}]:
            with self.subTest(change=change):
                self.hidden_text_release()
                self.report['engine_regressions'][0].update(change)
                with self.assertRaisesRegex(ValueError, 'Decoration evidence'):
                    self.verify(version='0.5.1')
        self.hidden_text_release()
        self.report['browser_matrix'][0]['decoration_source_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Browser decoration'):
            self.verify(version='0.5.1')
        self.hidden_text_release()
        self.report['browser_matrix'][0]['checks'] = 180
        with self.assertRaisesRegex(ValueError, 'Browser verification is incomplete'):
            self.verify(version='0.5.1')


class ComponentReleaseEvidenceTests(unittest.TestCase):
    def setUp(self):
        source = hashlib.sha256(release_check.COMPONENT_SOURCE.read_bytes()).hexdigest()
        self.report = dict(package_version='0.6.0', engine_version='2.5.24', package_sha256='a' * 64,
            component_authoring=[dict(platform=platform, ok=True, package_version='0.6.0', engine_version='2.5.24',
                tarball_sha256='a' * 64, source_sha256=source, documents=7, pages=13) for platform in ['win32', 'linux']],
            installed_matrix=[dict(component_documents=7, component_pages=13, component_jsx_equal=True, component_recovery=True) for _ in range(9)],
            browser_matrix=[dict(component_cases=7, component_editor_download=True, component_source_sha256=source) for _ in range(3)])

    def test_matching_component_evidence_is_accepted(self):
        release_check.verify_component_evidence(self.report)

    def test_stale_or_incomplete_pdf_inspections_are_rejected(self):
        for key, value in [('package_version', '0.5.1'), ('engine_version', 'old'), ('tarball_sha256', 'b' * 64),
                           ('source_sha256', 'b' * 64), ('documents', 6), ('pages', 12), ('ok', False)]:
            with self.subTest(key=key):
                self.setUp()
                self.report['component_authoring'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'Component PDF evidence'):
                    release_check.verify_component_evidence(self.report)

    def test_missing_platform_inspection_is_rejected(self):
        self.report['component_authoring'].pop()
        with self.assertRaisesRegex(ValueError, 'Windows and Linux'):
            release_check.verify_component_evidence(self.report)

    def test_missing_installed_jsx_or_recovery_is_rejected(self):
        for key, value in [('component_documents', 6), ('component_pages', 12), ('component_jsx_equal', False), ('component_recovery', False)]:
            with self.subTest(key=key):
                self.setUp()
                self.report['installed_matrix'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'Installed component'):
                    release_check.verify_component_evidence(self.report)

    def test_missing_browser_edit_or_wrong_fixture_is_rejected(self):
        for key, value in [('component_cases', 0), ('component_editor_download', False), ('component_source_sha256', 'b' * 64)]:
            with self.subTest(key=key):
                self.setUp()
                self.report['browser_matrix'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'Browser component'):
                    release_check.verify_component_evidence(self.report)


class HtmlExportReleaseEvidenceTests(unittest.TestCase):
    def setUp(self):
        source = hashlib.sha256(release_check.HTML_EXPORT_SOURCE.read_bytes()).hexdigest()
        self.report = dict(package_version='0.7.0', package_sha256='a' * 64,
            html_export=[dict(browser=browser, ok=True, package_version='0.7.0', tarball_sha256='a' * 64,
                source_sha256=source, documents=8, checks=48) for browser in ['chrome', 'firefox', 'webkit']],
            installed_matrix=[dict(component_html_exports_equal=True, html_export_fixtures=8) for _ in range(9)])

    def test_matching_html_export_evidence_is_accepted(self):
        release_check.verify_html_export_evidence(self.report)

    def test_missing_or_duplicate_browser_is_rejected(self):
        self.report['html_export'][2]['browser'] = 'chrome'
        with self.assertRaisesRegex(ValueError, 'all three browser'):
            release_check.verify_html_export_evidence(self.report)

    def test_stale_or_incomplete_exports_are_rejected(self):
        for key, value in [('package_version', '0.6.0'), ('tarball_sha256', 'b' * 64),
                           ('source_sha256', 'b' * 64), ('documents', 7), ('checks', 0), ('ok', False)]:
            with self.subTest(key=key):
                self.setUp()
                self.report['html_export'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'Static HTML export evidence'):
                    release_check.verify_html_export_evidence(self.report)

    def test_missing_installed_export_evidence_is_rejected(self):
        for key, value in [('component_html_exports_equal', False), ('html_export_fixtures', 7)]:
            with self.subTest(key=key):
                self.setUp()
                self.report['installed_matrix'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'Installed styled and unstyled'):
                    release_check.verify_html_export_evidence(self.report)


class PaintReleaseEvidenceTests(unittest.TestCase):
    def setUp(self):
        data = release_check.ENGINE_PAINT_SOURCE.read_bytes()
        fixture = json.loads(data)
        digest = hashlib.sha256(data).hexdigest()
        names = sorted(case['name'] for case in fixture['cases'])
        families = sorted({case['family'] for case in fixture['cases']})
        self.report = dict(package_version='0.7.1', engine_version=fixture['engineVersion'], package_sha256='a'*64,
            engine_paint=[dict(platform=platform, ok=True, package_version='0.7.1',
                engine_version=fixture['engineVersion'], tarball_sha256='a'*64, source_sha256=digest,
                negative_control=False, cases=2*len(names), families=families, case_names=names)
                for platform in ['win32', 'linux']],
            browser_matrix=[dict(browser=browser, paint_ok=True, paint_cases=len(names),
                paint_source_sha256=digest, paint_negative_control=False) for browser in ['chrome', 'firefox', 'webkit']],
            native_wasi_fixtures=[dict(name=name, nativeWasiPdfEqual=True, nativeWasiPreviewsEqual=True) for name in names])

    def test_complete_paint_evidence_is_accepted(self):
        release_check.verify_engine_paint_evidence(self.report)

    def test_missing_or_duplicate_platform_is_rejected(self):
        self.report['engine_paint'][0]['platform'] = 'linux'
        with self.assertRaisesRegex(ValueError, 'Windows and Linux'):
            release_check.verify_engine_paint_evidence(self.report)

    def test_wrong_package_or_incomplete_evidence_is_rejected(self):
        for key, value in [('ok', False), ('package_version', '0.7.0'), ('engine_version', '2.5.24'),
                           ('tarball_sha256', 'b'*64), ('source_sha256', 'b'*64), ('negative_control', True),
                           ('cases', 1), ('families', ['svg-cascade']), ('case_names', [])]:
            with self.subTest(key=key):
                self.setUp()
                self.report['engine_paint'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'Paint inspection is incomplete'):
                    release_check.verify_engine_paint_evidence(self.report)

    def test_browser_gaps_and_negative_controls_are_rejected(self):
        for key, value in [('paint_ok', False), ('paint_cases', 0), ('paint_source_sha256', 'b'*64),
                           ('paint_negative_control', True)]:
            with self.subTest(key=key):
                self.setUp()
                self.report['browser_matrix'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'Browser paint inspection'):
                    release_check.verify_engine_paint_evidence(self.report)
        self.setUp()
        self.report['browser_matrix'].pop()
        with self.assertRaisesRegex(ValueError, 'all three browser'):
            release_check.verify_engine_paint_evidence(self.report)

    def test_native_gaps_and_differences_are_rejected(self):
        for change in ['missing', 'duplicate', 'pdf', 'preview']:
            with self.subTest(change=change):
                self.setUp()
                rows = self.report['native_wasi_fixtures']
                if change == 'missing': rows.pop()
                elif change == 'duplicate': rows.append(dict(rows[-1]))
                elif change == 'pdf': rows[-1]['nativeWasiPdfEqual'] = False
                else: rows[-1]['nativeWasiPreviewsEqual'] = False
                with self.assertRaisesRegex(ValueError, 'Native/WASI paint comparison'):
                    release_check.verify_engine_paint_evidence(self.report)


if __name__ == '__main__':
    unittest.main()
