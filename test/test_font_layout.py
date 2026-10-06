# SPDX-License-Identifier: MIT
from copy import deepcopy
from pathlib import Path
import runpy
import unittest

compare = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'tools/verify-font-subsets.py'))['compare_layout']


class ReviewedLayoutTests(unittest.TestCase):
    def setUp(self):
        self.prior = dict(name='invoice', htmlSha256='html', cssSha256='css', pages=1,
                          text='TOTAL USD', previewsSha256=['old'], pdfiumPixelSha256=['old'], pdfSha256='old')
        self.reviewed = {**self.prior, 'previewsSha256': ['new'], 'pdfiumPixelSha256': ['new'], 'pdfSha256': 'new'}

    def test_unchanged_fixture_passes_and_reports_identity(self):
        self.assertTrue(compare(self.prior, self.prior))

    def test_reviewed_change_is_exact_and_not_reported_as_identical(self):
        self.assertFalse(compare(self.reviewed, self.prior, self.reviewed))

    def test_unreviewed_change_fails(self):
        with self.assertRaises(AssertionError):
            compare(self.reviewed, self.prior)

    def test_later_layout_or_pdf_drift_fails(self):
        for field, value in [('previewsSha256', ['drift']), ('pdfiumPixelSha256', ['drift']), ('pdfSha256', 'drift')]:
            with self.subTest(field=field), self.assertRaises(AssertionError):
                compare({**self.reviewed, field: value}, self.prior, self.reviewed)

    def test_review_cannot_allow_changed_content_source_or_page_count(self):
        for field, value in [('text', 'TOTAL'), ('htmlSha256', 'other'), ('cssSha256', 'other'), ('pages', 2)]:
            changed = {**self.reviewed, field: value}
            with self.subTest(field=field), self.assertRaises(AssertionError):
                compare(changed, self.prior, changed)

    def test_reviewed_baseline_without_legacy_comparison_still_rejects_drift(self):
        compare(self.reviewed, None, self.reviewed)
        changed = deepcopy(self.reviewed)
        changed['previewsSha256'][0] = 'unreviewed'
        with self.assertRaises(AssertionError):
            compare(changed, None, self.reviewed)


if __name__ == '__main__':
    unittest.main()
