"""Release gates reject missing batch surfaces, examples and independent evidence."""
from copy import deepcopy
from hashlib import sha256
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('batch_release_verification', ROOT / 'tools/verify-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class BatchReleaseTests(unittest.TestCase):
    def setUp(self):
        source = sha256(release.BATCH_SOURCE.read_bytes()).hexdigest()
        pages = {'batch-fixed': 2, 'batch-reflow': 5, 'batch-missing': 2, 'batch-components': 2,
                 'batch-literal': 1, 'batch-fallback-fixed': 2, 'batch-fallback-reflow': 2}
        fixtures = [dict(name=name, pages=count, cjsProcessAndQueueEqual=True, pdf='c' * 64) for name, count in pages.items()]
        batch = dict(ok=True, queueClosed=True, tests=28, packageVersion='0.9.0', engineVersion='2.5.46', fixtures=fixtures,
                     readmeExamples=[dict(name='readme-batch-' + str(index), pages=count, unmodifiedExampleSha256='d' * 64)
                                     for index, count in [(1, 2), (2, 1)]])
        reader = dict(ok=True, package_version='0.9.0', engine_version='2.5.46', tarball_sha256='a' * 64,
                      source_sha256=source, documents=9, pages=19, record_ranges_verified=True, glyph_reports_verified=True)
        self.report = dict(package_version='0.9.0', engine_version='2.5.46', package_sha256='a' * 64, batch_source_sha256=source,
            installed_matrix=[dict(tarball_sha256='a' * 64, batch_smoke=deepcopy(batch)) for _ in range(9)],
            batch_readers=[dict(reader, platform=platform) for platform in ('linux', 'win32')],
            browser_matrix=[dict(browser=browser, batch_cases=7, batch_source_sha256=source, batch_reports_equal=True,
                                 batch_records_snapshot=True, batch_failure_recovery=True) for browser in ('chrome', 'firefox', 'webkit')],
            native_wasi_fixtures=[dict(name=name, pages=count, batch=True, nativeWasiReportsEqual=True,
                                      nativeWasiPdfEqual=True, nativeWasiPreviewsEqual=True) for name, count in pages.items()])

    def test_complete_evidence_is_accepted(self):
        release.verify_batch_evidence(self.report)

    def test_wrong_source_or_tarball_is_rejected(self):
        for field in ('source', 'tarball'):
            with self.subTest(field=field):
                self.setUp()
                if field == 'source':
                    self.report['batch_source_sha256'] = 'b' * 64
                else:
                    self.report['installed_matrix'][0]['tarball_sha256'] = 'b' * 64
                with self.assertRaises(ValueError):
                    release.verify_batch_evidence(self.report)

    def test_duplicate_cases_or_missing_readme_examples_are_rejected(self):
        for field in ('fixtures', 'readmeExamples'):
            with self.subTest(field=field):
                self.setUp()
                rows = self.report['installed_matrix'][0]['batch_smoke'][field]
                rows[-1] = deepcopy(rows[0])
                with self.assertRaises(ValueError):
                    release.verify_batch_evidence(self.report)

    def test_missing_or_duplicate_independent_platform_is_rejected(self):
        self.report['batch_readers'][1]['platform'] = 'linux'
        with self.assertRaises(ValueError):
            release.verify_batch_evidence(self.report)

    def test_passing_pdf_bytes_cannot_hide_bad_reports_or_cleanup(self):
        for surface, field in [('native_wasi_fixtures', 'nativeWasiReportsEqual'),
                               ('browser_matrix', 'batch_reports_equal'), ('browser_matrix', 'batch_records_snapshot'),
                               ('browser_matrix', 'batch_failure_recovery'), ('batch_readers', 'glyph_reports_verified')]:
            with self.subTest(surface=surface, field=field):
                self.setUp()
                self.report[surface][0][field] = False
                with self.assertRaises(ValueError):
                    release.verify_batch_evidence(self.report)


if __name__ == '__main__':
    unittest.main()
