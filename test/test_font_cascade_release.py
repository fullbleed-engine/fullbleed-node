# SPDX-License-Identifier: MIT
"""Release gates reject missing outputs, incorrect font selections and wrong packages."""
import copy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_check', ROOT / 'tools/verify-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class FontCascadeReleaseTests(unittest.TestCase):
    def setUp(self):
        data = release.FONT_CASCADE_SOURCE.read_bytes()
        source = json.loads(data)
        def evidence(platform, negative=False):
            cases = []
            for case in source['cases']:
                actual = source['negativeControl']['actualBaseFonts'][case['name']] if negative else case['expectedBaseFonts']
                cases.append({'name': case['name'], 'pages': 1, 'missingGlyphs': 0, 'pdfSha256': '1' * 64,
                    'expectedBaseFonts': case['expectedBaseFonts'], 'actualBaseFonts': actual,
                    'matchesExpected': actual == case['expectedBaseFonts'],
                    'previews': [{'filename': case['name'] + '-1.png', 'sha256': '2' * 64}]})
            return {'ok': True, 'negativeControl': negative, 'platform': platform,
                'isolation': 'process', 'defaultStyles': False, 'fixtureSha256': sha256(data).hexdigest(),
                'packageVersion': '0.9.3' if negative else '0.9.4', 'engineVersion': '2.5.50' if negative else '2.5.51',
                'tarballSha256': '3' * 64, 'wasmSha256': '4' * 64, 'documents': 13, 'cases': cases,
                'failures': sorted(c['name'] for c in cases if not c['matchesExpected'])}
        self.report = {'package_version': '0.9.4', 'engine_version': '2.5.51', 'package_sha256': '3' * 64,
            'wasm_sha256': '4' * 64, 'font_cascade': [evidence('linux'), evidence('win32')],
            'font_cascade_negative_control': evidence('linux', True)}

    def test_complete_corrected_and_public_control_evidence(self):
        release.verify_font_cascade_evidence(self.report)

    def test_wrong_font_cannot_be_hidden_by_success_flag(self):
        self.report['font_cascade'][0]['cases'][0]['actualBaseFonts'] = ['Wrong']
        with self.assertRaises(ValueError):
            release.verify_font_cascade_evidence(self.report)

    def test_missing_case_platform_or_preview_is_rejected(self):
        for kind in ['case', 'platform', 'preview']:
            report = copy.deepcopy(self.report)
            if kind == 'case': report['font_cascade'][0]['cases'].pop()
            elif kind == 'platform': report['font_cascade'].pop()
            else: report['font_cascade'][0]['cases'][0]['previews'] = []
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                release.verify_font_cascade_evidence(report)

    def test_stale_source_package_or_engine_is_rejected(self):
        for key in ['fixtureSha256', 'tarballSha256', 'wasmSha256', 'packageVersion', 'engineVersion']:
            report = copy.deepcopy(self.report)
            report['font_cascade'][0][key] = 'wrong'
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.verify_font_cascade_evidence(report)

    def test_uncalibrated_negative_control_is_rejected(self):
        self.report['font_cascade_negative_control']['cases'][0]['actualBaseFonts'] = ['Wrong']
        with self.assertRaises(ValueError):
            release.verify_font_cascade_evidence(self.report)

    def test_cross_platform_output_difference_is_rejected(self):
        self.report['font_cascade'][1]['cases'][0]['pdfSha256'] = '5' * 64
        with self.assertRaises(ValueError):
            release.verify_font_cascade_evidence(self.report)

if __name__ == '__main__':
    unittest.main()
