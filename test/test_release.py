# SPDX-License-Identifier: MIT
import importlib.util
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


if __name__ == '__main__':
    unittest.main()
