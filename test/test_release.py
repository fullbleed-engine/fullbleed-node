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


if __name__ == '__main__':
    unittest.main()
