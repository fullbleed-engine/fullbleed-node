"""Reject incomplete or misattributed radial-gradient release evidence."""
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('radial_release_verification', ROOT / 'tools/verify-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class RadialGradientReleaseTests(unittest.TestCase):
    def setUp(self):
        source = release.RADIAL_GRADIENT_SOURCE.read_bytes()
        fixtures = json.loads(source)['cases']
        names = sorted(row['name'] for row in fixtures)
        failures = sorted(row['name'] for row in fixtures if row['affected'])
        positive = dict(ok=True, package_version='0.8.7', engine_version='2.5.43', negative_control=False,
            tarball_sha256='a' * 64, wasm_sha256='b' * 64, source_sha256=sha256(source).hexdigest(),
            cases=24, passing_color_cases=24, failing_color_cases=0, invalid_stitching_cases=0,
            core_matching_cases=24, unchanged_controls=4, case_names=names,
            case_keys=sorted(mode + ':' + name for mode in ('worker', 'process') for name in names), failed_case_names=[])
        negative = dict(positive, package_version='0.8.6', engine_version='2.5.41', negative_control=True,
            platform='linux', tarball_sha256=None, passing_color_cases=6, failing_color_cases=18,
            invalid_stitching_cases=20, core_matching_cases=4, unchanged_controls=0, failed_case_names=failures)
        self.report = dict(package_version='0.8.7', engine_version='2.5.43', package_sha256='a' * 64, wasm_sha256='b' * 64,
            radial_gradients=[dict(positive, platform=platform) for platform in ('linux', 'win32')],
            radial_gradients_negative_control=negative)

    def test_complete_fixture_evidence_is_accepted(self):
        release.verify_radial_gradient_evidence(self.report)

    def test_wrong_package_or_wasm_is_rejected(self):
        for key in ('tarball_sha256', 'wasm_sha256'):
            with self.subTest(key=key):
                self.setUp()
                self.report['radial_gradients'][0][key] = 'c' * 64
                with self.assertRaises(ValueError):
                    release.verify_radial_gradient_evidence(self.report)

    def test_duplicate_platform_or_case_cannot_replace_missing_evidence(self):
        for kind in ('platform', 'case'):
            with self.subTest(kind=kind):
                self.setUp()
                if kind == 'platform':
                    self.report['radial_gradients'][1]['platform'] = 'linux'
                else:
                    keys = self.report['radial_gradients'][0]['case_keys']
                    keys[-1] = keys[0]
                with self.assertRaises(ValueError):
                    release.verify_radial_gradient_evidence(self.report)

    def test_bad_pdf_bounds_cannot_be_hidden_by_passing_color_checks(self):
        self.report['radial_gradients'][0]['invalid_stitching_cases'] = 1
        with self.assertRaises(ValueError):
            release.verify_radial_gradient_evidence(self.report)

    def test_uncalibrated_failure_or_missing_preservation_control_is_rejected(self):
        for kind in ('failure', 'preservation'):
            with self.subTest(kind=kind):
                self.setUp()
                if kind == 'failure':
                    self.report['radial_gradients_negative_control']['failed_case_names'] = []
                else:
                    self.report['radial_gradients'][0]['unchanged_controls'] = 3
                with self.assertRaises(ValueError):
                    release.verify_radial_gradient_evidence(self.report)


if __name__ == '__main__':
    unittest.main()
