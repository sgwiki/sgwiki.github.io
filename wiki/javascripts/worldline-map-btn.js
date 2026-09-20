/*
  worldline-map-btn.js — 헤더의 세계선 맵 링크

  시각 스타일은 sg-theme.css 의 .worldline-map-btn 이 담당한다. 여기서는 구조만 만든다.

  ── 글리프 ──
  · 왼쪽에서 온 한 줄이 한 점에서 둘로 갈라지는 그림 = 세계선 분기. 맵이 보여주는 것
    자체이고 언어에 기대지 않는다.
  · fill="none" 은 프레젠테이션 속성이라 어떤 CSS 에도 진다. CSS 에서 fill 을 다시
    없애고 분기점 원만 .wl-dot 으로 되살린다.

  ── .md-header__button 을 쓰지 않는 이유 ──
  · 그 클래스의 Material 규칙(display:block, height, opacity, svg 1.2rem)이 더 높은
    특이도로 이겨서 inline-flex 배치가 깨졌다(글리프가 라벨 위로 떨어졌다).
    시각은 여기서 전부 정의하므로 그 클래스가 필요 없다 — 떼는 편이 특이도 싸움보다 낫다.
    포커스 링은 sg-theme.css 가 .worldline-map-btn:focus-visible 로 따로 준다.
*/
(() => {
  const MAP_URL = '/maps/';
  const BTN_CLASS = 'worldline-map-btn';
  const LABEL = 'Worldline Map';

  /* 한 점에서 두 갈래로 갈라지고 각 갈래 끝에 도착점이 찍힌다.
     끝점이 없으면 15px 에서 그냥 "≺" 로 읽힌다(실측). 가로를 18 로 넓혀
     줄기를 길게 빼야 "갈라진다"가 보인다. */
  const GLYPH =
    '<svg viewBox="0 0 18 16" aria-hidden="true" focusable="false" ' +
    'stroke="currentColor" stroke-width="1.3" stroke-linecap="round">' +
      '<path d="M1.4 8h4.4"/>' +
      '<path d="M5.8 8c3.1 0 3.1-4.1 7.6-4.1"/>' +
      '<path d="M5.8 8c3.1 0 3.1 4.1 7.6 4.1"/>' +
      '<circle class="wl-dot" cx="5.8" cy="8" r="1.25" stroke="none"/>' +
      '<circle class="wl-dot" cx="15.1" cy="3.9" r="1.1" stroke="none"/>' +
      '<circle class="wl-dot" cx="15.1" cy="12.1" r="1.1" stroke="none"/>' +
    '</svg>';

  function inject() {
    if (document.querySelector('.' + BTN_CLASS)) return;
    const inner = document.querySelector('.md-header__inner');
    if (!inner) return;

    const btn = document.createElement('a');
    btn.href = MAP_URL;
    btn.className = BTN_CLASS;
    btn.title = '세계선 인터랙티브 맵';
    btn.setAttribute('aria-label', '세계선 인터랙티브 맵');
    // 좁은 화면에서는 CSS 가 라벨을 감추고 글리프만 남긴다 — aria-label 이 이름을 잇는다.
    btn.innerHTML = GLYPH + '<span class="wl-label">' + LABEL + '</span>';

    const search = inner.querySelector('.md-search');
    search ? inner.insertBefore(btn, search) : inner.appendChild(btn);
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(inject);
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }
})();
