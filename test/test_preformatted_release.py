"""Reject incomplete or misattributed preformatted release evidence."""
import copy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release_verification',ROOT/'tools/verify-release.py')
release=importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class PreformattedReleaseTests(unittest.TestCase):
    def setUp(self):
        source=release.PREFORMATTED_SOURCE.read_bytes()
        fixtures=json.loads(source)['cases']
        names=sorted(row['name'] for row in fixtures)
        failures=sorted(row['name'] for row in fixtures if row['kind']=='wrap'
                        or (row['kind']=='whitespace' and not row['preserveIndent']))
        positive=dict(ok=True,package_version='0.8.6',engine_version='2.5.41',
            tarball_sha256='a'*64,source_sha256=sha256(source).hexdigest(),negative_control=False,
            cases=34,passed=34,failed=0,case_names=names,failed_case_names=[],unchanged_controls=14)
        negative={**positive,'platform':'linux','package_version':'0.8.5','engine_version':'2.5.40',
                  'negative_control':True,'passed':14,'failed':20,'failed_case_names':failures,'tarball_sha256':None}
        self.report=dict(package_version='0.8.6',engine_version='2.5.41',package_sha256='a'*64,
            preformatted_whitespace=[dict(positive,platform=p) for p in ['linux','win32']],
            preformatted_negative_controls=[negative])

    def test_complete_evidence_is_accepted(self):
        release.verify_preformatted_evidence(self.report)

    def test_missing_platform_is_rejected(self):
        self.report['preformatted_whitespace'].pop()
        with self.assertRaises(ValueError): release.verify_preformatted_evidence(self.report)

    def test_another_tarball_is_rejected(self):
        self.report['preformatted_whitespace'][0]['tarball_sha256']='b'*64
        with self.assertRaises(ValueError): release.verify_preformatted_evidence(self.report)

    def test_duplicate_case_cannot_replace_missing_case(self):
        row=self.report['preformatted_whitespace'][0]
        row['case_names']=row['case_names'][:-1]+[row['case_names'][0]]
        with self.assertRaises(ValueError): release.verify_preformatted_evidence(self.report)

    def test_uncalibrated_negative_control_is_rejected(self):
        self.report['preformatted_negative_controls'][0]['failed_case_names']=[]
        with self.assertRaises(ValueError): release.verify_preformatted_evidence(self.report)

    def test_changed_preservation_control_is_rejected(self):
        self.report['preformatted_whitespace'][0]['unchanged_controls']=13
        with self.assertRaises(ValueError): release.verify_preformatted_evidence(self.report)

if __name__=='__main__': unittest.main()
