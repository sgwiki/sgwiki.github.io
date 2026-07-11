/*
  sg-enhance.js — 위키 표시 계층 강화 (md 무편집)

  1) 인용 태그 칩: **[공식]**/**[팬 분석]**/**[심층]** → 색상 칩
  2) 온톨로지 산문 링크화 (P1-4): 본문 인라인 코드의 mnemonic ID
     (`Event_X` 등)를 /maps/?view=graph&focus=<id> 링크로 변환.
     실존 노드 id 목록(/maps/graph_node_ids.json)과 대조 — 미실존은 무변경.
  3) 온톨로지 그래프 임베드 (P2-1):
     - 명시 마커: <div data-sg-graph="Event_X"></div>
     - 세계선 자동: wiki/세계선/{divergence}-… 페이지는 발산률→WL id 역산.
       역산 실패(대응 노드 없음)는 조용히 생략. 마커가 있으면 마커 우선.

  모두 멱등(idempotent) — MkDocs Material instant navigation마다 재적용된다.
*/
(() => {
  // ─── 1) 인용 태그 칩 ─────────────────────────────────────────────
  const TAG_MAP = {
    '[공식]':   'sg-tag--official',
    '[팬 분석]': 'sg-tag--fan',
    '[팬분석]':  'sg-tag--fan',
    '[심층]':   'sg-tag--deep',
  };

  function decorateTags() {
    const root = document.querySelector('.md-typeset');
    if (!root) return;
    root.querySelectorAll('strong').forEach((el) => {
      if (el.classList.contains('sg-tag')) return;
      const cls = TAG_MAP[el.textContent.trim()];
      if (!cls) return;
      el.classList.add('sg-tag', cls);
    });
  }

  // ─── 공유: 온톨로지 노드 id 목록 (경량 파생물, 1회 fetch 후 캐시) ──
  const MNEMONIC_RE = /^(WL|Event|EV|CP|Shift|ME|MS|Topic|Evidence|AF)_[A-Za-z0-9_]+$/;

  function fetchNodeIds() {
    if (!window.__sgGraphNodeIds) {
      window.__sgGraphNodeIds = fetch('/maps/graph_node_ids.json')
        .then((r) => (r.ok ? r.json() : []))
        .then((ids) => new Set(ids))
        .catch(() => new Set());
    }
    return window.__sgGraphNodeIds;
  }

  function isDark() {
    // Material 팔레트: slate = 다크
    return document.body.getAttribute('data-md-color-scheme') === 'slate';
  }

  // ─── 2) 산문 인라인 코드 → 그래프 딥링크 (P1-4) ──────────────────
  function linkifyOntologyIds(nodeIds) {
    if (nodeIds.size === 0) return;
    const root = document.querySelector('.md-typeset');
    if (!root) return;
    root.querySelectorAll('code').forEach((el) => {
      if (el.closest('pre')) return;              // 코드 블록 제외 — 인라인만
      if (el.closest('a')) return;                // 이미 링크면 무변경
      if (el.classList.contains('sg-ontology-link')) return; // 멱등
      const text = el.textContent.trim();
      if (!MNEMONIC_RE.test(text) || !nodeIds.has(text)) return; // 실존 id만
      const a = document.createElement('a');
      a.href = `/maps/?view=graph&focus=${encodeURIComponent(text)}`;
      a.title = `온톨로지 그래프에서 ${text} 보기`;
      el.classList.add('sg-ontology-link');
      el.parentNode.insertBefore(a, el);
      a.appendChild(el);
    });
  }

  // ─── 3) 그래프 임베드 iframe (P2-1) ──────────────────────────────
  function buildEmbed(focusId) {
    const wrap = document.createElement('div');
    wrap.className = 'sg-graph-embed';
    wrap.style.cssText = 'margin:1.2em 0;max-width:100%;';
    const iframe = document.createElement('iframe');
    const theme = isDark() ? 'dark' : 'light';
    iframe.src = `/maps/?view=graph&focus=${encodeURIComponent(focusId)}&embed=1&theme=${theme}`;
    iframe.loading = 'lazy';
    iframe.title = `온톨로지 그래프: ${focusId}`;
    // 노드 클릭→위키 딥링크에 top-navigation(사용자 활성화) 필요
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-top-navigation-by-user-activation',
    );
    iframe.style.cssText =
      'width:100%;height:360px;border:1px solid var(--md-default-fg-color--lightest,#ddd);border-radius:6px;display:block;';
    wrap.appendChild(iframe);
    return wrap;
  }

  /** 세계선 문서 경로에서 WL id 역산 — generate-data.py build_wiki_slug_map의 역방향 */
  function worldlineIdFromPath() {
    const path = decodeURIComponent(window.location.pathname);
    const m = path.match(/\/세계선\/(-?\d+\.\d+)-/);
    if (!m) return null;
    const div = parseFloat(m[1]);
    if (Number.isNaN(div)) return null;
    const sign = div < 0 ? 'Neg_' : '';
    const [intPart, fracPart] = Math.abs(div).toFixed(6).split('.');
    return `WL_${sign}${intPart}_${fracPart}`;
  }

  function injectEmbeds(nodeIds) {
    if (nodeIds.size === 0) return;
    const root = document.querySelector('.md-typeset');
    if (!root) return;

    // 명시 마커 (P2-1 옵트인) — 콘텐츠 편집 경로
    const markers = root.querySelectorAll('div[data-sg-graph]');
    let hasMarker = false;
    markers.forEach((el) => {
      const id = (el.getAttribute('data-sg-graph') || '').trim();
      if (!id || !nodeIds.has(id)) return; // 미실존 id는 조용히 생략
      hasMarker = true;
      if (el.querySelector('iframe')) return; // 멱등
      el.appendChild(buildEmbed(id));
    });

    // 세계선 카테고리 자동 임베드 (연동 방향 2, md 무편집) — 마커가 있으면 마커 우선
    if (hasMarker || root.querySelector('.sg-graph-embed--auto')) return;
    const wlId = worldlineIdFromPath();
    if (!wlId || !nodeIds.has(wlId)) return; // 역산 실패 graceful skip
    const embed = buildEmbed(wlId);
    embed.classList.add('sg-graph-embed--auto');
    const heading = document.createElement('p');
    heading.style.cssText = 'font-size:.7rem;opacity:.65;margin:1.6em 0 .3em;';
    heading.textContent = '🕸 이 세계선의 온톨로지 이웃 그래프';
    embed.insertBefore(heading, embed.firstChild);
    root.appendChild(embed);
  }

  // ─── 적용 (instant navigation 대응) ──────────────────────────────
  function apply() {
    decorateTags();
    fetchNodeIds().then((nodeIds) => {
      linkifyOntologyIds(nodeIds);
      injectEmbeds(nodeIds);
    });
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(apply);   // Material 인스턴트 내비게이션 대응
  } else {
    document.addEventListener('DOMContentLoaded', apply);
  }
})();
