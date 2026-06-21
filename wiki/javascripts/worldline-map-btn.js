(() => {
  const MAP_URL = '/maps/';
  const BTN_CLASS = 'worldline-map-btn';
  const LABEL = 'Worldline Map';

  function inject() {
    if (document.querySelector('.' + BTN_CLASS)) return;
    const inner = document.querySelector('.md-header__inner');
    if (!inner) return;

    const btn = document.createElement('a');
    btn.href = MAP_URL;
    btn.className = 'md-header__button ' + BTN_CLASS;
    btn.title = '세계선 인터랙티브 맵';
    btn.setAttribute('aria-label', '세계선 인터랙티브 맵');
    btn.textContent = LABEL;

    // 헤더 텍스트 버튼 스타일 (별도 CSS 파일 없이 인라인 적용)
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      height: '1.6rem',
      margin: 'auto 0.2rem',
      padding: '0 0.7rem',
      border: '1px solid currentColor',
      borderRadius: '0.2rem',
      color: 'var(--md-primary-bg-color, #fff)',
      fontSize: '0.7rem',
      fontWeight: '700',
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
      textDecoration: 'none',
      opacity: '0.9',
    });

    const search = inner.querySelector('.md-search');
    search ? inner.insertBefore(btn, search) : inner.appendChild(btn);
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(inject);
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }
})();
