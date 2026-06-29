#!/usr/bin/env node
// Fandom Steins;Gate 에피소드 51개 → data/fandom_episodes/ 마크다운 변환 (영문 원문)
// Source: https://steins-gate.fandom.com/wiki/Category:Episodes (CC-BY-SA)
//
// Usage:
//   node scripts/fetch_fandom_episodes.mjs            # 수집 + 변환 (캐시 사용)
//   node scripts/fetch_fandom_episodes.mjs --refresh  # _raw 캐시 무시
//
// Phase 1: 결정론적 변환. 한국어 번역은 Phase 2에서 별도 진행.

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API = 'https://steins-gate.fandom.com/api.php';
const ROOT = path.resolve('data/fandom_episodes');
const RAW = path.join(ROOT, '_raw');
const CATEGORY_URL = 'https://steins-gate.fandom.com/wiki/Category:Episodes';
const COLLECT_DATE = '2026-06-29';
const SLEEP_MS = 500;
const REFRESH = process.argv.includes('--refresh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'sg-wiki-episode-fetcher/1.0 (https://sgwiki.github.io)' },
    });
    if (res.status === 429) {
      const wait = 1500 * (attempt + 2);
      console.warn(`  429 — retry in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }
  throw new Error(`rate-limited after retries: ${url}`);
}

// ---------------------------------------------------------------------------
// 1) 페이지 목록
// ---------------------------------------------------------------------------
async function getEpisodePages() {
  const url = `${API}?action=query&list=categorymembers&cmtitle=Category:Episodes&cmlimit=200&cmtype=page&format=json`;
  const data = await getJson(url);
  return data.query.categorymembers
    .map((m) => m.title)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

// ---------------------------------------------------------------------------
// 2) wikitext 가져오기 (캐시)
// ---------------------------------------------------------------------------
async function fetchWikitext(title) {
  const cacheFile = path.join(RAW, `${titleToCacheName(title)}.json`);
  if (!REFRESH && existsSync(cacheFile)) {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  const url = `${API}?action=parse&prop=wikitext&format=json&formatversion=2&page=${encodeURIComponent(title)}`;
  const data = await getJson(url);
  const wikitext = data?.parse?.wikitext ?? '';
  await mkdir(RAW, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({ title, wikitext }, null, 2));
  await sleep(SLEEP_MS);
  return { title, wikitext };
}

function titleToCacheName(title) {
  return title.replace(/[^A-Za-z0-9가-힣β]+/g, '_').replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------
// 3) {{Episode}} 템플릿 파싱
// ---------------------------------------------------------------------------
function extractTemplateBlock(wikitext, name) {
  const start = wikitext.indexOf(`{{${name}`);
  if (start === -1) return null;
  let depth = 0;
  let i = start;
  for (; i < wikitext.length - 1; i++) {
    const pair = wikitext.slice(i, i + 2);
    if (pair === '{{') { depth++; i++; }
    else if (pair === '}}') { depth--; i++; if (depth === 0) break; }
  }
  return wikitext.slice(start, i + 1);
}

function parseTemplateFields(block) {
  // 바깥 {{Name| ... }} 제거 — 첫 '|' 이후만 필드 영역
  const firstPipe = block.indexOf('|');
  if (firstPipe === -1) return {};
  let inner = block.slice(firstPipe + 1, block.lastIndexOf('}}'));
  const fields = {};
  let depthSq = 0, depthCu = 0, depthPa = 0, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    const nx = inner[i + 1];
    if (ch === '[' && nx === '[') { depthSq++; cur += '[['; i++; continue; }
    if (ch === ']' && nx === ']') { depthSq--; cur += ']]'; i++; continue; }
    if (ch === '{' && nx === '{') { depthCu++; cur += '{{'; i++; continue; }
    if (ch === '}' && nx === '}') { depthCu--; cur += '}}'; i++; continue; }
    if (ch === '(') depthPa++;
    if (ch === ')') depthPa--;
    if (ch === '|' && depthSq === 0 && depthCu === 0 && depthPa === 0) {
      pushField(cur, fields); cur = ''; continue;
    }
    cur += ch;
  }
  if (cur.trim()) pushField(cur, fields);
  return fields;
}

function pushField(raw, fields) {
  const eq = raw.indexOf('=');
  if (eq === -1) return;
  const key = raw.slice(0, eq).trim().toLowerCase();
  const val = raw.slice(eq + 1).trim();
  if (key) fields[key] = val;
}

// ---------------------------------------------------------------------------
// 4) wikitext → markdown 변환
// ---------------------------------------------------------------------------
// multiline 템플릿({{...}}) 괄호 카운팅 제거 — 본문 프로즈에는 거의 쓰이지 않음
function stripTemplatesBlock(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{' && s[i + 1] === '{') {
      let depth = 0;
      let j = i;
      let closed = false;
      for (; j < s.length - 1; j++) {
        const pair = s.slice(j, j + 2);
        if (pair === '{{') { depth++; j++; }
        else if (pair === '}}') { depth--; j++; if (depth === 0) { closed = true; break; } }
      }
      if (closed) { i = j + 1; continue; } // 템플릿 건너뜀
    }
    out += s[i];
    i++;
  }
  return out;
}
// ---------------------------------------------------------------------------
function stripMarkup(s) {
  if (!s) return '';
  let t = s;
  t = t.replace(/\[\[(?:File|Image|Datei):[^\]]*\]\]/gi, '');
  t = t.replace(/\[\[Category:[^\]]*\]\]/gi, '');
  t = t.replace(/<ref[^>]*\/>/gi, '');
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/<small>([\s\S]*?)<\/small>/gi, '$1');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');
  // [[A|B]] → B, [[A]] → A (namespace 제거)
  t = t.replace(/\[\[[^\]]*\|([^\]]*)\]\]/g, '$1');
  t = t.replace(/\[\[([^\]]*)\]\]/g, (_, g) =>
    g.replace(/^w:c:[^:]*:/, '').replace(/^[^:|]+:/, ''));
  t = t.replace(/'''([^']*)'''/g, '**$1**');
  t = t.replace(/''([^']*)''/g, '*$1*');
  t = decodeEntities(t);
  t = t.replace(/[ \t]+/g, ' ').trim();
  return t;
}

function decodeEntities(t) {
  return t
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function convertBody(wikitext) {
  let t = wikitext;
  // 헤딩
  t = t.replace(/^===\s*(.*?)\s*===\s*$/gm, '### $1');
  t = t.replace(/^==\s*(.*?)\s*==\s*$/gm, '## $1');
  t = t.replace(/^=\s*(.*?)\s*=\s*$/gm, '# $1');
  t = t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');
  t = t.replace(/\[\[Category:[^\]]*\]\]/gi, '');
  t = t.replace(/\{\{DISPLAYTITLE:[^}]*\}\}/gi, '');
  t = t.replace(/<ref[^>]*\/>/gi, '');
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/<small>([\s\S]*?)<\/small>/gi, '$1');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/\[\[[^\]]*\|([^\]]*)\]\]/g, '$1');
  t = t.replace(/\[\[([^\]]*)\]\]/g, (_, g) =>
    g.replace(/^w:c:[^:]*:/, '').replace(/^[^:|]+:/, ''));
  t = t.replace(/'''([^']*)'''/g, '**$1**');
  t = t.replace(/''([^']*)''/g, '*$1*');
  t = decodeEntities(t);
  // 남은 템플릿 제거 (multiline 포함, 괄호 카운팅) — Tabs/네비게이션 등
  t = stripTemplatesBlock(t);
  // 매직워드
  t = t.replace(/__[A-Z]+__/g, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function getSections(mdBody) {
  const parts = {};
  const re = /^##\s+(.+?)\s*$/gm;
  const idx = [];
  let m;
  while ((m = re.exec(mdBody)) !== null) {
    idx.push({ name: m[1].trim().toLowerCase(), start: m.index, headerEnd: re.lastIndex });
  }
  for (let i = 0; i < idx.length; i++) {
    const end = i + 1 < idx.length ? idx[i + 1].start : mdBody.length;
    parts[idx[i].name] = mdBody.slice(idx[i].headerEnd, end).trim();
  }
  return parts;
}

function pickSection(parts, ...keys) {
  for (const k of Object.keys(parts)) {
    if (keys.some((key) => k.includes(key))) return parts[k];
  }
  return '';
}

// 첫 헤딩(## ) 전의 도입 문단 — Overview 섹션이 없을 때 태그라인 대용
function extractLead(mdBody) {
  const m = mdBody.match(/^([\s\S]*?)(?=\n##\s)/);
  let lead = m ? m[1] : mdBody;
  return lead.trim();
}

// ---------------------------------------------------------------------------
// 5) 분류 · 파일명
// ---------------------------------------------------------------------------
function classify(rawTitle) {
  const lower = rawTitle.toLowerCase();
  if (lower.includes('movie') || lower.includes('déjà vu') || lower.includes('deja vu')) {
    return { dir: 'movie', series: 'Steins;Gate: The Movie - Load Region of Déjà Vu' };
  }
  if (lower.includes('s;g0')) return { dir: 'steins-gate-0', series: 'Steins;Gate 0' };
  return { dir: 'steins-gate', series: 'Steins;Gate' };
}

function episodeToken(rawTitle) {
  const m = rawTitle.match(/Ep\.(\d+)(?:-SP)?(-SP)?|(Ep\.(\d+)-SP)/);
  const sp = /-SP/.test(rawTitle);
  const beta = /β/.test(rawTitle);
  const numMatch = rawTitle.match(/Ep\.(\d+)/);
  const num = numMatch ? numMatch[1].padStart(2, '0') : '00';
  let suffix = '';
  if (sp) suffix = '-sp';
  else if (beta) suffix = '-beta';
  return { num, suffix };
}

function kebab(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
}

function subtitleFromTemplateTitle(titleField) {
  if (!titleField) return '';
  const stripped = stripMarkup(titleField); // "Episode 01: Prologue ... -Turning Point-"
  const colon = stripped.indexOf(':');
  let sub = colon >= 0 ? stripped.slice(colon + 1) : stripped;
  sub = sub.replace(/^episode\s+\d+\s*/i, '');
  return sub.trim();
}

function pageUrl(rawTitle) {
  return encodeURI(`https://steins-gate.fandom.com/wiki/${rawTitle.replace(/ /g, '_')}`);
}

// 메타 테이블용 정제 — 줄바꿈/표 구분자/---- 를 한 줄로 평탄화 (마크다운 표 깨짐 방지)
function cleanMeta(s) {
  if (!s) return '';
  return stripMarkup(s)
    .replace(/-{2,}/g, ' / ')            // ---- (가로선) → 구분자
    .replace(/\|/g, ' / ')               // 표 파이프 → 구분자
    .replace(/^[ \t]*\*[ \t]+/gm, ', ')  // 줄 시작 불릿(* +공백) → 쉼표 (italic *문자* 는 보존)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/^[,/\s]+|[,/\s]+$/g, '')   // 양끝 구분자/공백 제거
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// 6) 파일 본문 생성
// ---------------------------------------------------------------------------
function buildMarkdown({ rawTitle, meta, overview, plot }) {
  const url = pageUrl(rawTitle);
  const displayTitle = stripMarkup(meta.title || rawTitle);

  const rows = [];
  rows.push(`| 항목 | 값 |`);
  rows.push(`|---|---|`);
  rows.push(`| 시리즈 | ${cleanMeta(meta.series)} |`);
  rows.push(`| 화수 | ${cleanMeta(meta.episodenumber)} |`);
  if (meta.airdate) rows.push(`| 방영일 | ${cleanMeta(meta.airdate)} |`);
  if (meta.japanese) rows.push(`| 일본어 제목 | ${cleanMeta(meta.japanese)} |`);
  if (meta.rōmaji || meta.romaji) rows.push(`| 로마지 | ${cleanMeta(meta.rōmaji || meta.romaji)} |`);
  if (meta.direction) rows.push(`| 감독 | ${cleanMeta(meta.direction)} |`);
  if (meta.scenario) rows.push(`| 각본 | ${cleanMeta(meta.scenario)} |`);
  if (meta.storyboard) rows.push(`| 스토리보드 | ${cleanMeta(meta.storyboard)} |`);
  if (meta.previous) rows.push(`| 이전 화 | ${cleanMeta(meta.previous)} |`);
  if (meta.next) rows.push(`| 다음 화 | ${cleanMeta(meta.next)} |`);

  return `# ${displayTitle}

> 원문: ${url}
> 카테고리: ${CATEGORY_URL}
> 라이선스: CC-BY-SA (Fandom)
> 수집일: ${COLLECT_DATE}

## 에피소드 정보

${rows.join('\n')}

## Overview (EN)

${overview || '_(원문에 Overview 섹션이 없습니다.)_'}

## Plot (EN)

${plot || '_(원문에 Plot 섹션이 없습니다.)_'}

---

<!-- 한국어 번역은 Phase 2에서 이 지점 아래에 추가됩니다. -->
<!-- ## 개요 (한국어) -->
<!-- ## 줄거리 (한국어) -->
`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const pages = await getEpisodePages();
  console.log(`카테고리에서 ${pages.length}개 페이지 발견`);

  const manifest = [];
  const warnings = [];

  for (const rawTitle of pages) {
    const { wikitext } = await fetchWikitext(rawTitle);
    const { dir, series } = classify(rawTitle);
    const { num, suffix } = episodeToken(rawTitle);

    const epBlock = extractTemplateBlock(wikitext, 'Episode');
    const meta = epBlock ? parseTemplateFields(epBlock) : {};
    if (!epBlock) warnings.push(`[템플릿 없음] ${rawTitle}`);
    meta.series = meta.series || series;

    // 본문 = Episode 블록·DISPLAYTITLE 제거 후 변환
    let bodyText = wikitext;
    if (epBlock) bodyText = bodyText.replace(epBlock, '');
    bodyText = bodyText.replace(/\{\{DISPLAYTITLE:[^}]*\}\}/gi, '');
    const mdBody = convertBody(bodyText);
    const sections = getSections(mdBody);
    // 페이지 유형별 섹션 이름 변형 대응:
    //   본편 대부분: Overview(태그라인) + Plot(상세)
    //   본편 09/23β, S;G0: Synopsis(요약) — Plot 없음
    //   영화: Plot만
    const overviewSec = pickSection(sections, 'overview');
    const synopsisSec = pickSection(sections, 'synopsis');
    const plotSec = pickSection(sections, 'plot');
    const lead = extractLead(mdBody);

    let overview, plot;
    if (plotSec) {
      plot = plotSec;
      overview = overviewSec || synopsisSec || lead;
    } else if (synopsisSec) {
      plot = synopsisSec;
      overview = overviewSec || lead;
    } else {
      plot = '';
      overview = overviewSec || lead;
    }

    if (!overview) warnings.push(`[Overview 누락] ${rawTitle}`);
    if (!plot) warnings.push(`[Plot 누락] ${rawTitle}`);
    // 잔재 검사
    const residue = (plot + '\n' + overview).match(/\{\{|\[\[File:|<ref/g);
    if (residue) warnings.push(`[잔재 ${residue.length}] ${rawTitle}`);

    // 파일명
    let filename;
    if (dir === 'movie') {
      filename = 'load-region-of-deja-vu.md';
    } else {
      const slug = kebab(subtitleFromTemplateTitle(meta.title)) || 'untitled';
      filename = `ep${num}${suffix}-${slug}.md`;
    }

    const outDir = path.join(ROOT, dir);
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, filename);
    const content = buildMarkdown({ rawTitle, meta, overview, plot });
    await writeFile(outPath, content, 'utf8');

    manifest.push({ dir, filename, rawTitle, url: pageUrl(rawTitle), series, ep: num + suffix });
    console.log(`  ✓ ${dir}/${filename}`);
  }

  // manifest 저장 (Phase 3 인덱스/번역용)
  await writeFile(path.join(ROOT, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`\n완료: ${manifest.length}개 파일`);
  if (warnings.length) {
    console.log(`\n경고 ${warnings.length}건:`);
    for (const w of warnings) console.log(`  ${w}`);
  } else {
    console.log('경고 없음.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
