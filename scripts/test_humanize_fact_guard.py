#!/usr/bin/env python3
"""humanize_fact_guard fixture tests."""

import importlib.util
import os
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "humanize_fact_guard", os.path.join(_HERE, "humanize_fact_guard.py")
)
hfg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hfg)


def base(body: str, spoiler: str = "endgame") -> str:
    return f"---\nspoiler: {spoiler}\ntype: test\n---\n\n{body}\n"


class HumanizeFactGuardTest(unittest.TestCase):
    def test_passes_style_only_change(self):
        before = base("2026년 7월 1일, 세계선 1.048596에서 사건을 설명합니다.")
        after = base("2026년 7월 1일, 세계선 1.048596에서 사건을 다룹니다.")
        self.assertEqual(hfg.check(before, after), [])

    def test_detects_number_change(self):
        before = base("세계선 1.048596에서 3명이 움직입니다.")
        after = base("세계선 1.048597에서 3명이 움직입니다.")
        violations = hfg.check(before, after)
        self.assertEqual(violations[0]["type"], "number_tokens_changed")
        self.assertIn("1.048596", violations[0]["diff"])
        self.assertIn("1.048597", violations[0]["diff"])

    def test_detects_spoiler_change(self):
        before = base("본문", spoiler="main_story")
        after = base("본문", spoiler="endgame")
        violations = hfg.check(before, after)
        self.assertEqual(violations[0]["type"], "spoiler_changed")

    def test_allows_spoiler_quote_style(self):
        before = base("본문", spoiler='"endgame"')
        after = base("본문", spoiler="endgame")
        self.assertEqual(hfg.check(before, after), [])

    def test_detects_blockquote_change(self):
        before = base("> **[공식]** 숫자 1.048596 자체는 유지합니다.\n\n본문")
        after = base("> **[공식]** 숫자 1.048596 자체는 보존합니다.\n\n본문")
        violations = hfg.check(before, after)
        self.assertEqual(violations[0]["type"], "blockquote_text_changed")

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            before = os.path.join(tmp, "before.md")
            after = os.path.join(tmp, "after.md")
            with open(before, "w", encoding="utf-8") as fh:
                fh.write(base("2026년"))
            with open(after, "w", encoding="utf-8") as fh:
                fh.write(base("2026년"))
            self.assertEqual(hfg.main(["--before", before, "--after", after]), 0)
            with open(after, "w", encoding="utf-8") as fh:
                fh.write(base("2027년"))
            self.assertEqual(hfg.main(["--before", before, "--after", after]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
