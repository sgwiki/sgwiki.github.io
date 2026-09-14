/*
  sg-enhance.js — 위키 표시 계층 강화 (md 무편집)

  1) 인용 태그 칩: **[공식]** · **[팬 분석]** · **[심층]** → 색상 칩
  2) 온톨로지 산문 링크화 (P1-4): 본문 인라인 코드의 mnemonic ID
     (`Event_X` 등)를 /maps/?view=graph&focus=<id> 링크로 변환.
     패턴(MNEMONIC_RE)만으로 판정한다 — 노드 id 목록에 의존하지 않는다.
     존재하지 않는 id 를 넘겨도 맵은 정상 렌더한다(2026-09-15 실측). 목록에
     의존하던 때는 그 파일이 다른 프로젝트의 빌드 산출물이라, SPA 쪽 정리
     커밋 하나로 이 기능이 조용히 죽었다.

  (P2-1 그래프 임베드는 2026-09-15 제거했다. 이 파일의 원칙은 "md 무편집" 인데
   명시 마커는 마크다운에 직접 쓰는 것이고 경로 자동 추론은 파일명 때문에 없던
   콘텐츠를 만든다 — 둘 다 원칙을 어겼다. 실패 방식도 달랐다: 1)·2)는 실패하면
   페이지가 밋밋해질 뿐 정확하지만, 임베드는 있어야 할 것이 조용히 없어진다.
   실제로 배포된 적이 한 번도 없이 휴면이었다. 산문의 mnemonic ID 는 2)가
   딥링크로 잇는다.)

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

  const MNEMONIC_RE = /^(WL|Event|EV|CP|Shift|ME|MS|Topic|Evidence|AF)_[A-Za-z0-9_]+$/;

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

  // ─── 적용 (instant navigation 대응) ──────────────────────────────
  function apply() {
    decorateTags();
    linkifyOntologyIds();
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(apply);   // Material 인스턴트 내비게이션 대응
  } else {
    document.addEventListener('DOMContentLoaded', apply);
  }
})();
