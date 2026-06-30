#!/usr/bin/env python3
"""wiki_link_lint 픽스처 테스트.

실행: python3 scripts/test_wiki_link_lint.py  (또는 make test)
"""
import importlib.util
import os
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    'wiki_link_lint', os.path.join(_HERE, 'wiki_link_lint.py'))
wll = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wll)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


class LinkLintTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, 'wiki')
        # 타깃 파일들
        write(os.path.join(self.root, 'lore/foo.md'), '# foo\n')
        write(os.path.join(self.root, 'lore/bar.md'), '# bar\n')
        write(os.path.join(self.root, 'uniq/onlyhere.md'), '# only\n')
        write(os.path.join(self.root, 'dup1/dup.md'), '# d1\n')
        write(os.path.join(self.root, 'dup2/dup.md'), '# d2\n')
        write(os.path.join(self.root, 'test/sibling.md'), '# sib\n')
        self.index = wll.build_basename_index(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def _lint(self, body, apply=False):
        page = os.path.join(self.root, 'test/page.md')
        write(page, body)
        return wll.lint_file(page, self.index, apply), page

    def test_ok_valid_links(self):
        body = (
            '[rel](../lore/foo.md)\n'
            '[bare](sibling.md)\n'
            '[anchor](../lore/foo.md#sec)\n'
            '[inpage](#top)\n'
            '[ext](https://example.com)\n'
        )
        r, _ = self._lint(body)
        self.assertEqual(r['summary']['ok'], 4)         # rel, bare, anchor, inpage
        self.assertEqual(r['summary']['external'], 1)   # ext
        self.assertEqual(r['summary']['broken'], 0)
        self.assertEqual(r['summary']['suspicious'], 0)

    def test_autofix_unique_basename(self):
        r, page = self._lint('[x](../wrong/onlyhere.md)\n', apply=False)
        self.assertEqual(r['summary']['fixed'], 1)
        self.assertEqual(r['fixed'][0]['to'], '../uniq/onlyhere.md')
        # --apply 없이는 파일 불변
        self.assertIn('../wrong/onlyhere.md', read(page))

    def test_autofix_apply_writes(self):
        r, page = self._lint('[크리스](../wrong/onlyhere.md)\n', apply=True)
        txt = read(page)
        self.assertIn('[크리스](../uniq/onlyhere.md)', txt)   # 경로만 교정, 텍스트 유지
        self.assertNotIn('../wrong/', txt)

    def test_autofix_preserves_fragment(self):
        r, _ = self._lint('[x](../wrong/onlyhere.md#part)\n')
        self.assertEqual(r['fixed'][0]['to'], '../uniq/onlyhere.md#part')

    def test_broken_missing(self):
        r, _ = self._lint('[x](../nope/ghost.md)\n')
        self.assertEqual(r['summary']['broken'], 1)
        self.assertIn('not found', r['broken'][0]['reason'])

    def test_broken_ambiguous(self):
        r, _ = self._lint('[x](../somewhere/dup.md)\n')
        self.assertEqual(r['summary']['broken'], 1)
        self.assertIn('ambiguous', r['broken'][0]['reason'])

    def test_suspicious_wikilink(self):
        r, _ = self._lint('본문 [[lore/foo|푸]] 참고\n')
        whys = [s['why'] for s in r['suspicious']]
        self.assertTrue(any('wikilink' in w for w in whys))

    def test_suspicious_link_debris(self):
        r, _ = self._lint('마유리](../lore/bar.md)가 등장한다\n')
        whys = [s['why'] for s in r['suspicious']]
        self.assertTrue(any('debris' in w for w in whys))

    def test_suspicious_link_shaped_bracket(self):
        r, _ = self._lint('[../lore/bar.md] 를 보라\n')
        whys = [s['why'] for s in r['suspicious']]
        self.assertTrue(any('소괄호 누락' in w for w in whys))

    def test_suspicious_non_md_internal(self):
        # 절대경로(/)·디렉토리(/끝)가 아닌, 확장자 없는 상대 내부 참조만 의심
        r, _ = self._lint('[x](../lore/bar)\n')
        whys = [s['why'] for s in r['suspicious']]
        self.assertTrue(any('non-md' in w for w in whys))

    def test_no_false_positive_label(self):
        r, _ = self._lint('> **[공식]** 공식 QA 설명\n> **[팬 분석]** 분석\n')
        self.assertEqual(r['summary']['suspicious'], 0)

    def test_no_false_positive_footnote(self):
        r, _ = self._lint('주장입니다[^2][^3] 그리고 결론[^11].\n\n[^2]: 출처\n[^3]: 출처\n')
        self.assertEqual(r['summary']['suspicious'], 0)

    def test_no_false_positive_date_bracket(self):
        r, _ = self._lint('[베타 세계선: 크리스 사망 (7/28)] 항목\n')
        self.assertEqual(r['summary']['suspicious'], 0)

    def test_no_false_positive_image(self):
        r, _ = self._lint('![figure](https://i.imgur.com/abc.jpeg) 설명\n')
        self.assertEqual(r['summary']['suspicious'], 0)
        self.assertEqual(r['summary']['external'], 1)

    def test_ok_absolute_site_path(self):
        r, _ = self._lint('[맵](/maps/anime/){: .md-button }\n')
        self.assertEqual(r['summary']['suspicious'], 0)
        self.assertEqual(r['summary']['ok'], 1)

    def test_ok_directory_link(self):
        r, _ = self._lint('[목록](../애니메이션-에피소드/steins-gate/)\n')
        self.assertEqual(r['summary']['suspicious'], 0)
        self.assertEqual(r['summary']['ok'], 1)

    def test_no_false_positive_code_fence(self):
        body = '```js\ndocument.getElementById("x").addEventListener("submit", fn(\n```\n정상 문장\n'
        r, _ = self._lint(body)
        self.assertEqual(r['summary']['suspicious'], 0)

    def test_exit_code_via_summary(self):
        clean, _ = self._lint('[ok](../lore/foo.md)\n')
        self.assertEqual(clean['summary']['broken'] + clean['summary']['suspicious'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
