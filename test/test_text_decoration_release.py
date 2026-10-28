# SPDX-License-Identifier: MIT
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verify_release', Path(__file__).resolve().parents[1] / 'tools/verify-release.py')
release_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_check)


class TextDecorationReleaseEvidenceTests(unittest.TestCase):
    def setUp(self):
        source_sha = hashlib.sha256(release_check.TEXT_DECORATIONS_SOURCE.read_bytes()).hexdigest()
        oracle_bytes = release_check.TEXT_DECORATIONS_EXPECTATIONS.read_bytes()
        oracle_sha = hashlib.sha256(oracle_bytes).hexdigest()
        oracle = json.loads(oracle_bytes)
        names = sorted(row['name'] for row in oracle['cases'])
        failures = sorted(row['name'] for row in oracle['cases'] if row['previousEngineFails'])
        self.report = dict(package_version='0.8.4', engine_version='2.5.40', package_sha256='a' * 64,
            text_decorations=[dict(platform=platform, ok=True, package_version='0.8.4', engine_version='2.5.40',
                tarball_sha256='a' * 64, source_sha256=source_sha, expectations_sha256=oracle_sha,
                negative_control=False, cases=32, passed=32, failed=0, glyph_geometry_cases=32,
                case_names=names, unchanged_controls=6 if platform == 'linux' else 0) for platform in ['linux', 'win32']],
            browser_matrix=[dict(browser=browser, text_decorations_ok=True, text_decorations_cases=16,
                text_decorations_passed=16, text_decorations_failed=0, text_decorations_glyph_geometry_cases=16,
                text_decorations_source_sha256=source_sha, text_decorations_expectations_sha256=oracle_sha,
                text_decorations_case_names=names, text_decorations_negative_control=False)
                for browser in ['chrome', 'firefox', 'webkit']],
            text_decorations_negative_controls=[dict(platform='linux', ok=True, negative_control=True,
                package_version='0.8.3', engine_version='2.5.38', source_sha256=source_sha, expectations_sha256=oracle_sha,
                cases=32, passed=6, failed=26, glyph_geometry_cases=32, failed_case_names=failures)],
            native_wasi_fixtures=[dict(name='text-decorations-' + name, nativeWasiPdfEqual=True, nativeWasiPreviewsEqual=True) for name in names])

    def test_complete_artifact_bound_evidence_is_accepted(self):
        release_check.verify_text_decorations_evidence(self.report)

    def test_another_package_or_oracle_cannot_substitute_for_candidate_evidence(self):
        for field, value in [('tarball_sha256', 'b' * 64), ('expectations_sha256', 'b' * 64), ('package_version', '0.8.3')]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.report)
                changed['text_decorations'][0][field] = value
                with self.assertRaises(ValueError):
                    release_check.verify_text_decorations_evidence(changed)

    def test_missing_platform_case_or_geometry_check_is_rejected(self):
        for field, value in [('platform', 'linux'), ('cases', 31), ('glyph_geometry_cases', 31)]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.report)
                changed['text_decorations'][1][field] = value
                with self.assertRaises(ValueError):
                    release_check.verify_text_decorations_evidence(changed)

    def test_browser_coverage_and_oracle_are_required(self):
        for field, value in [('browser', 'firefox'), ('text_decorations_cases', 15), ('text_decorations_expectations_sha256', 'b' * 64)]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.report)
                changed['browser_matrix'][0][field] = value
                with self.assertRaises(ValueError):
                    release_check.verify_text_decorations_evidence(changed)

    def test_false_negative_control_and_changed_healthy_output_are_rejected(self):
        changed = copy.deepcopy(self.report)
        changed['text_decorations_negative_controls'][0].update(passed=32, failed=0, failed_case_names=[])
        with self.assertRaisesRegex(ValueError, 'failure control'):
            release_check.verify_text_decorations_evidence(changed)
        changed = copy.deepcopy(self.report)
        changed['text_decorations'][0]['unchanged_controls'] = 5
        with self.assertRaisesRegex(ValueError, 'healthy controls'):
            release_check.verify_text_decorations_evidence(changed)

    def test_missing_or_failed_native_wasi_comparison_is_rejected(self):
        changed = copy.deepcopy(self.report)
        changed['native_wasi_fixtures'].pop()
        with self.assertRaisesRegex(ValueError, 'native/WASI'):
            release_check.verify_text_decorations_evidence(changed)
        changed = copy.deepcopy(self.report)
        changed['native_wasi_fixtures'][0]['nativeWasiPreviewsEqual'] = False
        with self.assertRaisesRegex(ValueError, 'native/WASI'):
            release_check.verify_text_decorations_evidence(changed)


if __name__ == '__main__':
    unittest.main()
