/*
  sg-enhance.js — 위키 표시 계층 강화 (md 무편집)

  1) 인용 태그 칩: **[공식]** · **[팬 분석]** · **[심층]** → 색상 칩
  2) 온톨로지 산문 링크화 (P1-4): 본문 인라인 코드의 mnemonic ID
     (`Event_X` 등)를 /maps/?view=graph&focus=<id> 링크로 변환.
     패턴(MNEMONIC_RE)만으로 판정한다 — 노드 id 목록에 의존하지 않는다.
     존재하지 않는 id 를 넘겨도 맵은 정상 렌더한다(2026-09-15 실측). 목록에
     의존하던 때는 그 파일이 다른 프로젝트의 빌드 산출물이라, SPA 쪽 정리
     커밋 하나로 이 기능이 조용히 죽었다.
  3) 온톨로지 그래프 임베드 (P2-1):
     - 명시 마커: <div data-sg-graph="Event_X"></div>
     - 세계선 자동: wiki/세계선/{divergence}-… 페이지는 발산률→WL id 역산.
       역산 실패(대응 노드 없음)는 조용히 생략. 마커가 있으면 마커 우선.

  모두 멱등(idempotent) — MkDocs Material instant navigation마다 재적용된다.
  ※ 이 주석 안에서 별표 뒤에 슬래시를 붙이지 말 것. 블록 주석이 거기서 끝나고
    아래 전부가 코드로 파싱되어 파일 전체가 죽는다. c62025d 가 구분자를 쉼표에서
    슬래시로 바꾸면서 정확히 그렇게 됐고, 그 뒤로 이 파일의 세 기능이 전부
    라이브에서 동작하지 않았다(2026-09-15 발견·복구).
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

  // ─── 3) 전용: 온톨로지 노드 id 목록 (1회 fetch 후 캐시) ──
  // 2)는 더 이상 쓰지 않는다. 3)만 쓰고, 그것도 실제로 필요한 페이지에서만
  // 부른다 — 모든 문서가 이 파일을 한 번씩 때리면 404 가 페이지마다 찍힌다.
  // 이 파일은 현재 public 저장소에서 .gitignore 되어 있어 배포본에 없다.
  // 따라서 3)은 휴면 상태다(처분은 별건).
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
  function linkifyOntologyIds() {
    const root = document.querySelector('.md-typeset');
    if (!root) return;
    root.querySelectorAll('code').forEach((el) => {
      if (el.closest('pre')) return;              // 코드 블록 제외 — 인라인만
      if (el.closest('a')) return;                // 이미 링크면 무변경
      if (el.classList.contains('sg-ontology-link')) return; // 멱등
      const text = el.textContent.trim();
      if (!MNEMONIC_RE.test(text)) return;        // 패턴만 — 존재 검사 없음
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
  /** 3)이 필요한 페이지에서만 노드 id 목록을 가져온다. 마커도 없고 세계선
   *  문서도 아니면 요청 자체를 하지 않는다. */
  function maybeInjectEmbeds() {
    const root = document.querySelector('.md-typeset');
    if (!root) return;
    const needed = root.querySelector('div[data-sg-graph]') || worldlineIdFromPath();
    if (!needed) return;
    fetchNodeIds().then(injectEmbeds);
  }

  function apply() {
    decorateTags();
    linkifyOntologyIds();
    maybeInjectEmbeds();
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(apply);   // Material 인스턴트 내비게이션 대응
  } else {
    document.addEventListener('DOMContentLoaded', apply);
  }
})();
