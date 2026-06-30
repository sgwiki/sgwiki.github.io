#!/usr/bin/env python3
"""wiki_link_lint — 위키 마크다운 링크 결정적 검사·교정 funnel.

2단계 funnel:
  Stage 1 (이 도구, 결정적): 라인별 링크 토큰을 추출해 ok/autofix/broken/suspicious/external로
    분류하고, unique-basename 내부 경로만 안전하게 자동 교정한다(--apply).
  Stage 2 (agent 정밀): valid 패턴 검사에 실패하고 [ ] ( ) .md 를 포함한 라인 전체를
    suspicious[]로 추려서 agent가 그 라인만 읽어 정밀 수정한다.

외부 URL(http/https)은 오프라인 도구가 검증하지 않고 목록만 제공한다(wiki-linker curl 담당).

사용:
  python3 scripts/wiki_link_lint.py --file wiki/{cat}/{slug}.md [--apply] [--json]
  python3 scripts/wiki_link_lint.py --scan [--apply] [--json]

exit code: 0 = broken/suspicious 없음, 1 = 잔존(게이트용), 2 = 사용법 오류.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

# 인라인 링크 [text](href) — 이미지 ![..]는 선행 ! 제외
LINK_RE = re.compile(r'(?<!\!)\[([^\]]+)\]\(([^)]+)\)')
# Obsidian 위키링크 [[...]]
WIKILINK_RE = re.compile(r'\[\[[^\]]+\]\]')
# 각주 정의 라인 [^id]: ...
FOOTNOTE_DEF_RE = re.compile(r'^\s*\[\^[^\]]+\]:')
# 일반 대괄호 토큰(각주 [^..] 제외)
BRACKET_TOKEN_RE = re.compile(r'(?<!\[)\[([^\[\]^][^\[\]]*)\]')
EXTERNAL_RE = re.compile(r'^(?:https?:)?//|^https?://')


def list_md_files(wiki_root: str) -> list[str]:
    out = []
    for dirpath, _dirs, files in os.walk(wiki_root):
        if os.sep + '_template' in os.sep + dirpath:
            continue
        for fn in files:
            if fn.endswith('.md'):
                out.append(os.path.join(dirpath, fn))
    return out


def build_basename_index(wiki_root: str) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for p in list_md_files(wiki_root):
        index.setdefault(os.path.basename(p), []).append(p)
    return index


def split_fragment(href: str) -> tuple[str, str]:
    if '#' in href:
        base, frag = href.split('#', 1)
        return base, '#' + frag
    return href, ''


def classify_href(href: str, file_dir: str, index: dict[str, list[str]]):
    """반환: (kind, payload). kind in ok/autofix/broken/external/suspicious."""
    href = href.strip()
    base, frag = split_fragment(href)

    if base == '':  # 동일 페이지 앵커 (#section)
        return 'ok', None
    if base.startswith('http://') or base.startswith('https://'):
        return 'external', {'href': href}
    if base.startswith('mailto:'):
        return 'ok', None
    if not base.endswith('.md'):
        # .md 가 아닌 내부 참조(디렉토리·확장자 누락 등) — 정밀 검사 대상
        return 'suspicious', {'why': 'non-md-internal', 'href': href}

    resolved = os.path.normpath(os.path.join(file_dir, base))
    if os.path.exists(resolved):
        return 'ok', None

    # 깨진 내부 링크 → basename 유일 일치 시 autofix
    matches = index.get(os.path.basename(base), [])
    if len(matches) == 1:
        corrected = os.path.relpath(matches[0], file_dir).replace(os.sep, '/') + frag
        if corrected != href:
            return 'autofix', {'from': href, 'to': corrected,
                               'reason': 'unique basename match'}
        return 'ok', None
    return 'broken', {'href': href,
                      'reason': 'basename not found' if not matches
                      else f'ambiguous basename ({len(matches)} matches)'}


def detect_suspicious(line: str, recognized_spans: list[tuple[int, int]]):
    """recognized 링크 영역을 제거한 잔여에서 의심 구조 탐지. 반환: why|None."""
    if FOOTNOTE_DEF_RE.match(line):
        return None
    if WIKILINK_RE.search(line):
        return 'wikilink [[...]]'

    # recognized 링크 스팬을 공백으로 치환한 잔여
    chars = list(line)
    for s, e in recognized_spans:
        for i in range(s, e):
            chars[i] = ' '
    residual = ''.join(chars)
    # 각주 참조 [^id] 제거(정상)
    residual = re.sub(r'\[\^[^\]]+\]', ' ', residual)

    # [텍스트] 뒤에 ( 가 없는 경우 — 단, 텍스트가 링크 형태(경로/.md/http)일 때만.
    # `[공식]`·`[팬 분석]` 같은 인용 라벨은 정상이므로 제외한다.
    for m in BRACKET_TOKEN_RE.finditer(residual):
        text = m.group(1)
        nxt = residual[m.end():m.end() + 1]
        link_shaped = ('.md' in text or text.startswith('http'))
        if nxt != '(' and link_shaped:
            return 'link-shaped bracket without (link) — 소괄호 누락 의심'

    # 링크 잔해: 닫히지 않은 `](`, 상대경로 `../`, 깨진 `.md)` 등.
    # (산문의 일반 괄호는 여러 줄에 걸칠 수 있어 단순 괄호 균형 검사는 하지 않는다.)
    if '](' in residual or '../' in residual or '.md)' in residual or '.md(' in residual:
        return 'link-debris (], (, ../, .md)'
    return None


def lint_file(path: str, index: dict[str, list[str]], apply: bool):
    file_dir = os.path.dirname(path)
    with open(path, encoding='utf-8') as fh:
        original = fh.read()
    lines = original.splitlines(keepends=True)

    report = {'file': path.replace(os.sep, '/'),
              'fixed': [], 'broken': [], 'suspicious': [], 'external': [],
              'ok_count': 0}
    new_lines = []
    in_fence = False

    for lineno, line in enumerate(lines, 1):
        if line.lstrip().startswith('```'):
            in_fence = not in_fence
            new_lines.append(line)
            continue
        if in_fence:  # 코드 펜스 내부는 링크 검사 제외
            new_lines.append(line)
            continue
        recognized_spans: list[tuple[int, int]] = []
        events: list[tuple[int, int, str, str]] = []  # (start, end, oldtoken, newtoken)

        for m in LINK_RE.finditer(line):
            text, href = m.group(1), m.group(2)
            if text.startswith('^'):  # 각주 잔해
                continue
            kind, payload = classify_href(href, file_dir, index)
            recognized_spans.append((m.start(), m.end()))
            if kind == 'ok':
                report['ok_count'] += 1
            elif kind == 'external':
                report['external'].append({'line': lineno, 'href': payload['href']})
            elif kind == 'autofix':
                report['fixed'].append({'line': lineno, 'from': payload['from'],
                                        'to': payload['to'], 'reason': payload['reason']})
                old_tok = m.group(0)
                new_tok = f'[{text}]({payload["to"]})'
                events.append((m.start(), m.end(), old_tok, new_tok))
            elif kind == 'broken':
                report['broken'].append({'line': lineno, 'href': payload['href'],
                                         'reason': payload['reason']})
            elif kind == 'suspicious':
                report['suspicious'].append({'line': lineno, 'text': line.rstrip('\n'),
                                             'why': payload['why']})

        why = detect_suspicious(line, recognized_spans)
        if why:
            report['suspicious'].append({'line': lineno, 'text': line.rstrip('\n'), 'why': why})

        if apply and events:
            rebuilt = line
            for _s, _e, old_tok, new_tok in sorted(events, key=lambda x: -x[0]):
                rebuilt = rebuilt[:_s] + new_tok + rebuilt[_e:]
            new_lines.append(rebuilt)
        else:
            new_lines.append(line)

    if apply and report['fixed']:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(''.join(new_lines))

    report['summary'] = {
        'ok': report['ok_count'],
        'fixed': len(report['fixed']),
        'broken': len(report['broken']),
        'suspicious': len(report['suspicious']),
        'external': len(report['external']),
    }
    del report['ok_count']
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='위키 마크다운 링크 결정적 검사·교정 funnel')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--file', help='단일 파일 경로 (예: wiki/cat/slug.md)')
    g.add_argument('--scan', action='store_true', help='wiki-root 전체 스캔')
    ap.add_argument('--wiki-root', default='wiki', help='위키 루트 (기본: wiki)')
    ap.add_argument('--apply', action='store_true', help='안전 자동 교정을 파일에 기록')
    ap.add_argument('--json', action='store_true', help='JSON 출력')
    args = ap.parse_args(argv)

    if not os.path.isdir(args.wiki_root):
        print(f'wiki-root not found: {args.wiki_root}', file=sys.stderr)
        return 2

    index = build_basename_index(args.wiki_root)

    if args.file:
        if not os.path.isfile(args.file):
            print(f'file not found: {args.file}', file=sys.stderr)
            return 2
        targets = [args.file]
    else:
        targets = list_md_files(args.wiki_root)

    reports = [lint_file(t, index, args.apply) for t in targets]

    agg = {'fixed': 0, 'broken': 0, 'suspicious': 0, 'external': 0, 'ok': 0}
    for r in reports:
        for k in agg:
            agg[k] += r['summary'][k]

    if args.json:
        out = reports[0] if args.file else {'mode': 'scan', 'summary': agg, 'files': reports}
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for r in reports:
            s = r['summary']
            if s['fixed'] or s['broken'] or s['suspicious']:
                print(f"{r['file']}: fixed={s['fixed']} broken={s['broken']} "
                      f"suspicious={s['suspicious']} external={s['external']}")
        print(f"TOTAL fixed={agg['fixed']} broken={agg['broken']} "
              f"suspicious={agg['suspicious']} external={agg['external']}")

    return 1 if (agg['broken'] or agg['suspicious']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
