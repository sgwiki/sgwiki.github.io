/*
  amadeus-chat-btn.js — 우측 하단 아마데우스 채팅 런처

  chat.flaglow.cc 를 iframe 으로 띄운다. 패널은 접었다 펼 수 있고, 기본은 접힘.

  ── 주간/야간 ──
  · 위키 팔레트(Material 토글, body[data-md-color-scheme]) 를 따라간다. 패널
    크롬(런처·제목줄)은 CSS 속성 셀렉터로, iframe 속 위젯은 ?theme= 파라미터(첫
    페인트) + postMessage amadeus:theme(이후 전환) 로 전달한다.

  ── 알아둘 제약 ──
  · 기본은 펼침이다(2026-09-15 요청). 대가가 있다: 위키 페이지를 볼 때마다
    iframe 이 로드되고 WS 연결이 하나씩 열린다. 지연 로드의 이점이 첫 방문에
    한해 사라지는 셈이라, 대신 방문자가 닫으면 그 선택을 기억한다(localStorage).
    한 번 닫은 사람은 다시 열기 전까지 연결하지 않는다.
  · 위키(sgwiki.github.io) 안의 iframe 이므로 chat.flaglow.cc 의 쿠키·localStorage 는
    "서드파티 맥락"이 된다. Safari(ITP)는 쿠키를 막고, 파티셔닝 때문에 iframe 과
    새 창은 저장소 버킷 자체가 다르다 — 그래서 "새 창" 을 눌러도 핸드오프 없이는
    대화가 빈 상태로 시작된다.
    → 헤더의 "새 창" 은 iframe 에게 postMessage 로 핸드오프 URL(vid·세션 핸들 토큰)
      을 받아 그 대화를 그대로 연다. iframe 이 아직 안 채워졌으면(응답 없음) 평범한
      CHAT_URL 로 연다 — 거기서도 프록시의 session.latest 가 신원이 이어지는 만큼은
      되찾아온다.
  · 이 사이트는 navigation.instant 를 쓰지 않으므로 페이지 이동 시 iframe 이 다시
    로드된다. 세션은 chat 쪽 localStorage 의 sessionKey 로 재개된다(위 제약 적용).
*/
(() => {
  const CHAT_URL = 'https://chat.flaglow.cc/';
  const CHAT_ORIGIN = new URL(CHAT_URL).origin;
  const ID = 'amadeus-chat-root';

  /* ── 위키 주간/야간 따라가기 ──
     Material 토글이 body 의 data-md-color-scheme 을 'default'(주간)/'slate'(야간)
     로 설정한다(sg-theme.css 의 낮/박 분기와 같은 근거). 이 스크립트가 Material
     초기화보다 먼저 뛸 때는 Material 이 저장해 둔 선택(localStorage __palette)에서
     라디오 순서로 되찾는다 — 첫 화면 어긋남을 줄이는 용도고, 어긋나도 아래
     옵저버가 곧 바로잡는다. */
  function wikiTheme() {
    let a = document.body.getAttribute('data-md-color-scheme');
    if (!a) {
      try {
        const p = JSON.parse(localStorage.getItem('__palette') || 'null');
        const radios = document.querySelectorAll('input[name="__palette"]');
        if (p && typeof p.index === 'number' && radios[p.index]) {
          a = radios[p.index].getAttribute('data-md-color-scheme');
        }
      } catch (e) { /* 비밀 모드 등 — 야간 기본으로 간다 */ }
    }
    return a === 'default' ? 'light' : 'dark';
  }
  function withTheme(url) {
    // 위젯의 핸드오프 URL 이 이미 &theme= 를 실을 수 있다(2026-09-17 커밋 78b1a82) —
    // set() 이라 같은 파라미터가 두 번 붙지 않는다.
    const u = new URL(url);
    u.searchParams.set('theme', wikiTheme());
    return u.href;
  }

  function build() {
    if (document.getElementById(ID)) return;   // 전역 1회 — body 는 교체되지 않는다

    const root = document.createElement('div');
    root.id = ID;

    const style = document.createElement('style');
    style.textContent = `
      #${ID} { position: fixed; right: 20px; bottom: 20px; z-index: 1000;
               font-family: -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; }
      #${ID} .ac-launcher {
        width: 56px; height: 56px; border-radius: 50%; cursor: pointer;
        background: #16120D; color: #E5B842;
        border: 1px solid rgba(255,153,0,.65);
        box-shadow: inset 0 0 0 1px rgba(229,184,66,.25), 0 6px 20px rgba(0,0,0,.35),
                    0 0 22px rgba(255,153,0,.22);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Playfair Display', Georgia, serif; font-weight: 700; font-size: 24px;
        line-height: 1; transition: transform 180ms ease, box-shadow 180ms ease;
      }
      #${ID} .ac-launcher:hover { transform: translateY(-2px);
        box-shadow: inset 0 0 0 1px rgba(229,184,66,.45), 0 8px 26px rgba(0,0,0,.4),
                    0 0 30px rgba(255,153,0,.38); }
      #${ID} .ac-launcher:focus-visible { outline: 2px solid #E5B842; outline-offset: 3px; }

      #${ID} .ac-panel {
        position: absolute; right: 0; bottom: 70px;
        width: min(390px, calc(100vw - 32px));
        height: min(600px, calc(100vh - 140px));
        background: #110D08; border: 1px solid rgba(229,184,66,.45); border-radius: 6px;
        box-shadow: 0 18px 48px rgba(0,0,0,.55); overflow: hidden;
        display: flex; flex-direction: column;
        opacity: 0; transform: translateY(8px) scale(.99); pointer-events: none;
        transition: opacity 180ms ease, transform 180ms ease;
      }
      #${ID}.ac-open .ac-panel { opacity: 1; transform: none; pointer-events: auto; }

      #${ID} .ac-bar {
        flex: none; display: flex; align-items: center; gap: 8px;
        padding: 9px 10px 9px 14px; background: #1A140D;
        border-bottom: 1px solid rgba(229,184,66,.35);
      }
      #${ID} .ac-title {
        font-family: 'Playfair Display', Georgia, serif; font-weight: 700;
        font-size: 14px; letter-spacing: .08em; color: #E5B842; margin-right: auto;
      }
      #${ID} .ac-bar a, #${ID} .ac-bar button {
        background: none; border: none; cursor: pointer; padding: 5px 7px;
        color: #A89878; font-size: 15px; line-height: 1; text-decoration: none;
        border-radius: 4px;
      }
      #${ID} .ac-bar a:hover, #${ID} .ac-bar button:hover { color: #E5B842; background: rgba(255,153,0,.12); }
      #${ID} .ac-frame { flex: 1; width: 100%; border: 0; background: #110D08; }

      /* 주간(한낮 옥상) — 위키 팔레트가 default 로 바뀌면 패널 크롬도 밝아진다.
         data-md-color-scheme 은 Material 토글이 body 에 설정/해제한다(sg-theme.css 와
         같은 근거). iframe 속 위젯은 postMessage 로 별도로 따라간다(아래 pushTheme). */
      body[data-md-color-scheme="default"] #${ID} .ac-launcher {
        background: #FBF6EA; color: #8A6410;
        border-color: rgba(163,74,5,.55);
        box-shadow: inset 0 0 0 1px rgba(138,100,16,.2), 0 6px 20px rgba(120,90,30,.18),
                    0 0 22px rgba(163,74,5,.12);
      }
      body[data-md-color-scheme="default"] #${ID} .ac-launcher:focus-visible { outline-color: #8A6410; }
      body[data-md-color-scheme="default"] #${ID} .ac-panel {
        background: #FFFDF6; border-color: rgba(138,100,16,.45);
        box-shadow: 0 18px 48px rgba(120,90,30,.25);
      }
      body[data-md-color-scheme="default"] #${ID} .ac-bar {
        background: #F5EFE2; border-bottom-color: rgba(138,100,16,.35);
      }
      body[data-md-color-scheme="default"] #${ID} .ac-title { color: #8A6410; }
      body[data-md-color-scheme="default"] #${ID} .ac-bar a,
      body[data-md-color-scheme="default"] #${ID} .ac-bar button { color: #79694B; }
      body[data-md-color-scheme="default"] #${ID} .ac-bar a:hover,
      body[data-md-color-scheme="default"] #${ID} .ac-bar button:hover {
        color: #8A6410; background: rgba(163,74,5,.1);
      }
      body[data-md-color-scheme="default"] #${ID} .ac-frame { background: #F5EFE2; }

      @media (max-width: 480px) {
        #${ID} { right: 14px; bottom: 14px; }
        #${ID} .ac-panel { height: min(560px, calc(100vh - 110px)); }
      }
      @media (prefers-reduced-motion: reduce) {
        #${ID} .ac-launcher, #${ID} .ac-panel { transition: none !important; }
      }
    `;

    const panel = document.createElement('div');
    panel.className = 'ac-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '아마데우스 채팅');

    const bar = document.createElement('div');
    bar.className = 'ac-bar';
    bar.innerHTML =
      '<span class="ac-title">Amadeus</span>' +
      `<a href="${CHAT_URL}" target="_blank" rel="noopener noreferrer" class="ac-newwin" ` +
      'title="새 창에서 열기 — 대화가 확실히 이어집니다" aria-label="새 창에서 열기">↗</a>' +
      '<button type="button" class="ac-close" title="닫기" aria-label="닫기">✕</button>';

    const frame = document.createElement('iframe');
    frame.className = 'ac-frame';
    frame.title = '아마데우스 채팅';
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('allow', 'clipboard-write');

    panel.appendChild(bar);
    panel.appendChild(frame);

    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'ac-launcher';
    launcher.textContent = 'A';
    launcher.title = '아마데우스에게 묻기';
    launcher.setAttribute('aria-label', '아마데우스 채팅 열기');
    launcher.setAttribute('aria-expanded', 'false');

    root.appendChild(style);
    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);

    // 방문자가 닫아둔 상태는 기억한다. 기본이 펼침이라 이 기억이 없으면
    // 닫은 사람도 페이지를 넘길 때마다 다시 열린 채로 만난다.
    var PREF = 'amadeus_chat_panel';
    function pref() { try { return localStorage.getItem(PREF); } catch (e) { return null; } }
    function setPref(v) { try { localStorage.setItem(PREF, v); } catch (e) {} }

    function open(remember) {
      // 첫 펼침에만 src 를 붙인다 — 닫아둔 방문자는 연결 자체를 하지 않는다.
      // ?theme= 은 첫 페인트를 위키 팔레트에 맞춘다(로드 뒤에는 postMessage 로 따라간다).
      if (!frame.src) frame.src = withTheme(CHAT_URL);
      root.classList.add('ac-open');
      launcher.setAttribute('aria-expanded', 'true');
      launcher.setAttribute('aria-label', '아마데우스 채팅 닫기');
      if (remember) setPref('open');
    }
    function close(remember) {
      root.classList.remove('ac-open');
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-label', '아마데우스 채팅 열기');
      if (remember) setPref('closed');
      launcher.focus();
    }

    launcher.addEventListener('click', () =>
      root.classList.contains('ac-open') ? close(true) : open(true));
    bar.querySelector('.ac-close').addEventListener('click', () => close(true));

    /* 패널 크롬은 위 CSS(body[data-md-color-scheme]) 가 알아서 바꾼다. iframe 속
       위젯은 크로스 오리진이라 여기서 밀어줘야 한다 — 로드 직후 한 번, 위키
       팔레트가 바뀔 때마다 한 번. */
    const newwin = bar.querySelector('.ac-newwin');
    newwin.href = withTheme(CHAT_URL);
    function pushTheme() {
      newwin.href = withTheme(CHAT_URL);
      try {
        frame.contentWindow.postMessage({ type: 'amadeus:theme', theme: wikiTheme() }, CHAT_ORIGIN);
      } catch (e) { /* 아직 about:blank — 로드되면 load 핸들러가 다시 민다 */ }
    }
    frame.addEventListener('load', pushTheme);
    new MutationObserver(pushTheme)
      .observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });

    // 새 창 — iframe 속 대화(vid·세션 핸들)를 핸드오프 토큰으로 건네받아 같은 대화로
    // 연다. 파티셔닝 때문에 iframe 과 새 창은 저장소 버킷이 다르다: URL 로 건네지
    // 않으면 새 창은 이 대화를 모르는 상태로 시작한다.
    // window.open 을 제스처 안에서 동기적으로 먼저 열어야 팝업 차단에 걸리지 않는다.
    // 핸드오프 URL 은 postMessage 왕복 뒤 도착하는 대로 빈 창에 넣는다(noopener 대신
    // opener 를 직접 끊는다 — noopener 로 열면 반환값이 null 이 되어 위치를 못 준다).
    newwin.addEventListener('click', (e) => {
      const win = window.open('', '_blank');
      if (!win) return;            // 차단됐다 — 기본 <a> 내비게이션이 맡게 둔다
      e.preventDefault();
      try { win.opener = null; } catch (err) { /* cross-origin 경계에서는 무해하다 */ }
      // 어떤 URL 이든 위키 팔레트를 실어 보낸다(핸드오프 ?h= 뒤에 &theme= 로 얹는다).
      const serve = (url) => { try { win.location.href = withTheme(url); } catch (err) {} };
      let settled = false;
      const onReply = (ev) => {
        if (ev.origin !== CHAT_ORIGIN) return;
        if (!ev.data || ev.data.type !== 'amadeus:handoff' || typeof ev.data.url !== 'string') return;
        settled = true;
        window.removeEventListener('message', onReply);
        serve(ev.data.url);
      };
      window.addEventListener('message', onReply);
      setTimeout(() => {
        if (settled) return;
        window.removeEventListener('message', onReply);
        serve(CHAT_URL);           // iframe 이 아직 응답 못 했다 — 평범하게 연다
      }, 350);
      try {
        frame.contentWindow.postMessage({ type: 'amadeus:handoff-request' }, CHAT_ORIGIN);
      } catch (err) { /* 위 시간 초과가 CHAT_URL 폴백을 처리한다 */ }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('ac-open')) close(true);
    });

    // 기본 펼침 — 방문자가 명시적으로 닫아둔 경우에만 접은 채로 시작한다.
    if (pref() !== 'closed') open(false);
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(build);
  } else {
    document.addEventListener('DOMContentLoaded', build);
  }
})();
