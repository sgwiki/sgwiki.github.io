#!/usr/bin/env python3
"""humanize_protect_quotes fixture tests."""

import importlib.util
import os
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "humanize_protect_quotes", os.path.join(_HERE, "humanize_protect_quotes.py")
)
hpq = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hpq)


class HumanizeProtectQuotesTest(unittest.TestCase):
    def test_restores_changed_quote_line(self):
        before = "> **[공식]** \"선택받은 자\"라고 부른다.\n\n본문을 설명합니다.\n"
        after = "> **[공식]** 선택받은 자라고 부른다.\n\n본문을 다룹니다.\n"
        restored, result = hpq.restore_quote_lines(before, after)
        self.assertEqual(result["status"], "pass")
        self.assertTrue(result["changed"])
        self.assertIn("> **[공식]** \"선택받은 자\"라고 부른다.", restored)
        self.assertIn("본문을 다룹니다.", restored)

    def test_allows_normal_paragraph_only_change(self):
        before = "> **[팬 분석]** 인용 블록은 유지합니다.\n\n본문을 설명합니다.\n"
        after = "> **[팬 분석]** 인용 블록은 유지합니다.\n\n본문을 다룹니다.\n"
        restored, result = hpq.restore_quote_lines(before, after)
        self.assertEqual(result["status"], "pass")
        self.assertFalse(result["changed"])
        self.assertEqual(restored, after)

    def test_fails_when_quote_count_changes(self):
        before = "> **[공식]** 첫 인용입니다.\n\n본문\n"
        after = "본문만 남았습니다.\n"
        _restored, result = hpq.restore_quote_lines(before, after)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["reason"], "blockquote line count changed")

    def test_cli_apply_writes_restored_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            before = os.path.join(tmp, "before.md")
            after = os.path.join(tmp, "after.md")
            with open(before, "w", encoding="utf-8") as fh:
                fh.write("> **[공식]** \"선택받은 자\"입니다.\n\n본문\n")
            with open(after, "w", encoding="utf-8") as fh:
                fh.write("> **[공식]** 선택받은 자입니다.\n\n본문\n")

            self.assertEqual(hpq.main(["--before", before, "--after", after, "--apply"]), 0)
            with open(after, encoding="utf-8") as fh:
                self.assertIn("\"선택받은 자\"", fh.read())


if __name__ == "__main__":
    unittest.main(verbosity=2)
