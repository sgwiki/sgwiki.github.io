/*
  인용 태그 → 색상 칩 변환
  본문에서 **[공식]**, **[팬 분석]**, **[심층]** 으로 작성된 강조 텍스트를
  (= <strong>[공식]</strong>) 의미별 칩으로 치환한다.
  순수 CSS로는 텍스트 내용 기준 선택이 불가능하므로 최소 JS로 보완.
  멱등(idempotent): 이미 변환된 노드는 건너뛴다.
*/
(() => {
  const MAP = {
    '[공식]':   'sg-tag--official',
    '[팬 분석]': 'sg-tag--fan',
    '[팬분석]':  'sg-tag--fan',
    '[심층]':   'sg-tag--deep',
  };

  function decorate() {
    const root = document.querySelector('.md-typeset');
    if (!root) return;
    root.querySelectorAll('strong').forEach((el) => {
      if (el.classList.contains('sg-tag')) return;
      const cls = MAP[el.textContent.trim()];
      if (!cls) return;
      el.classList.add('sg-tag', cls);
    });
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(decorate);   // Material 인스턴트 내비게이션 대응
  } else {
    document.addEventListener('DOMContentLoaded', decorate);
  }
})();
