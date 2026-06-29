#!/usr/bin/env node
// data/fandom_episodes/README.md 인덱스 자동 생성
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'data/fandom_episodes';
const manifest = JSON.parse(readFileSync(path.join(ROOT, '_manifest.json'), 'utf8'));

const h1 = (relPath) => {
  const txt = readFileSync(path.join(ROOT, relPath), 'utf8');
  const m = txt.match(/^# (.+)$/m);
  return m ? m[1] : '?';
};

const GROUPS = [
  { dir: 'steins-gate', title: 'Steins;Gate (본편)', count: '24화 + Ep.25-SP OVA + Ep.23β' },
  { dir: 'steins-gate-0', title: 'Steins;Gate 0', count: '23화 + Ep.24-SP OVA' },
  { dir: 'movie', title: '극장판', count: 'Load Region of Déjà Vu' },
];

let out = `# Fandom 에피소드 데이터

> **출처**: https://steins-gate.fandom.com/wiki/Category:Episodes
> **라이선스**: CC-BY-SA (Fandom Steins;Gate Wiki)
> **수집일**: 2026-06-29
> **건수**: 에피소드 51개 (영문 원문 + 한국어 번역)

각 파일은 Fandom 위키의 해당 에피소드 페이지를 마크다운으로 변환한 것으로, **영문 원문(Overview/Plot)과 한국어 번역을 함께** 포함한다. 헤더에 원문 URL·카테고리 URL·라이선스·수집일, 본문에 에피소드 정보 테이블(화수·방영일·감독·각본·이전/다음 화)이 포함된다.

번역은 \`_glossary.md\` 의 통일 용어표(리딩 슈타이너/세계선/D메일/타임리프/미래 가젯 연구소/아마데우스, 캐릭터명 등)를 따른다.

> 참고: \`data/\` 디렉터리는 프로젝트 .gitignore 규칙에 따라 git 추적에서 제외된다(로컬 데이터 영역). 이 데이터를 위키 빌드(\`wiki/\`)에 반영하려면 별도 복사/가공이 필요하다.

`;

for (const g of GROUPS) {
  const items = manifest.filter((x) => x.dir === g.dir);
  out += `## ${g.title} — ${g.count}\n\n`;
  out += `| 화수 | 에피소드 | 파일 | 원문 |\n|---|---|---|---|\n`;
  for (const it of items) {
    const rel = `${g.dir}/${it.filename}`;
    const title = h1(rel).replace(/\|/g, '\\|');
    const epRaw = (it.ep || '')
      .toUpperCase()
      .replace('-BETA', 'β')
      .replace('-SP', ' SP')
      .trim();
    const ep = (!epRaw || epRaw === '00') ? '—' : epRaw;
    out += `| ${ep} | ${title} | [${it.filename}](${rel}) | [원문](${it.url}) |\n`;
  }
  out += `\n`;
}

out += `## 메타\n\n`;
out += `- \`scripts/fetch_fandom_episodes.mjs\` — 수집·변환 스크립트 (MediaWiki API → 마크다운). \`node scripts/fetch_fandom_episodes.mjs [--refresh]\`\n`;
out += `- \`_manifest.json\` — 51개 파일 메타(화수·경로·원문 URL)\n`;
out += `- \`_glossary.md\` — 한국어 번역 통일 용어집\n`;
out += `- \`_raw/\` — Fandom API 응답 원본 캐시(wikitext JSON, 재수집용)\n`;

writeFileSync(path.join(ROOT, 'README.md'), out, 'utf8');
console.log(`README.md 생성 완료: ${manifest.length}개 항목`);
