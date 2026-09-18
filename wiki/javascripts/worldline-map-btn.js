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
    // 시각 스타일은 sg-theme.css의 .worldline-map-btn 규칙이 담당 (터치타깃 포함)

    const search = inner.querySelector('.md-search');
    search ? inner.insertBefore(btn, search) : inner.appendChild(btn);
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(inject);
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }
})();
