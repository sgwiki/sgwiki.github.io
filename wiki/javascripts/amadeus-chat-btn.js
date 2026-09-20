/*
  amadeus-chat-btn.js — 우측 하단 아마데우스 채팅 런처 + 적시 동의 게이트

  ── 게이트가 여기 있는 이유 ──
  · chat.flaglow.cc 는 **HTML 문서 응답에** Set-Cookie 를 실어 보낸다
    (webchat_uid; Max-Age=31536000; HttpOnly; Secure; SameSite=None).
    위젯 스크립트도 init 시점에 localStorage amadeus_vid 를 민팅한다.
    → iframe 문서가 도착하는 순간 둘 다 끝나 있다. iframe **안**에 동의 모달을
      두면 이미 받은 뒤에 물어보는 꼴이다.
    → 그래서 게이트는 frame.src 를 붙이기 전, 이쪽(위키 출처)이어야 한다.

  ── 기본 접힘으로 되돌린 것 ──
  · 원본은 기본 펼침이었다(2026-09-15 요청). 동의 게이트가 들어오면 첫 방문은
    어차피 연결하지 않으므로 그 전제가 사라진다. 동의 전에는 접힌 채로 시작하고,
    동의한 방문자에게만 예전의 "닫아둔 선택을 기억한다" 규칙이 이어진다.

  ── 죽은 시간(dead air) 과 흰 깜빡임 ──
  · 동의 전에는 iframe 을 한 번도 받지 않았으므로, [동의하기] 직후에 DNS+TLS+문서
    왕복이 통째로 보인다. preconnect 로 줄인다 — TCP/TLS 핸드셰이크만 하고 HTTP
    요청은 안 보낸다. 프록시는 .html 응답에만 Set-Cookie 를 붙이므로 동의 전에
    깔아도 쿠키가 안 생긴다.
  · 그 사이 화면이 **흰색으로 번쩍인다**. src 가 없는 iframe 은 about:blank 이고,
    Chrome 은 새 문서가 그릴 준비가 될 때까지 그 흰 캔버스를 계속 보여준다.
    요소의 background 로는 안 덮인다 — 문서 캔버스가 그 위에 칠해지기 때문이다.
    → iframe 요소에 color-scheme 을 준다. 그러면 about:blank 의 UA 기본 캔버스가
      그 스킴을 따라가서 야간에는 어둡게 시작한다. 위키 팔레트를 따라 바꾼다.
  · 그 공백은 CONNECTING 브리지가 덮는다. 다만 **언제 걷느냐가 전부다** —
    iframe 의 load 에 걸면 안 된다(실측 4.8초). 그러면 로그인 시퀀스가 브리지
    뒤에서 혼자 다 지나가 끝물만 보인다. 위젯이 준비됐다는 신호에 걷는다.
  · 브리지는 로그인 게이트의 첫 화면을 그대로 흉내 낸다 — 같은 위치의 헤더줄,
    같은 크기(min(440px,78vw))의 로고, 같은 서브라인, 같은 스캔라인·비네트.
    폼이 들어설 자리만 비워 두고 그 아래 CONNECTING 을 둔다. 걷히는 순간
    로고가 제자리에 있으므로 이음매가 보이지 않는다.

  ── 동의 화면과 로그인 시퀀스를 분리한 이유 ──
  · 로그인 게이트는 연출이다(진짜 input 이 아니라 div, 자동 타이핑, AUTH OK).
    진짜 법적 동의를 그 연출의 한 단계로 만들면 고지가 픽션으로 읽힌다.
    크롬(색·모노 헤더·각진 상자)만 승계하고, 본문은 평범한 한국어 본문 크기로,
    두 버튼은 크기·대비를 대칭으로 둔다. 자동 타이핑·카운트다운은 두지 않는다.
*/
(() => {
  const CHAT_URL = 'https://chat.flaglow.cc/';
  const CHAT_ORIGIN = new URL(CHAT_URL).origin;
  const ID = 'amadeus-chat-root';

  /* 동의 상태. 버전을 값으로 둔다 — 고지 내용이 바뀌면 v2 로 올려 다시 묻는다. */
  const CONSENT_KEY = 'amadeus_consent';
  const CONSENT_VERSION = 'v1';
  const POLICY_URL = '/개인정보처리방침/';

  /* 브리지를 띄울지 말지를 가르는 탭 플래그.
     위젯의 로그인 시퀀스는 **탭당 한 번**이다(위젯 sessionStorage 의
     amadeus_boot_played). 그런데 위키는 navigation.instant 를 쓰지 않아 문서를
     넘길 때마다 iframe 이 통째로 다시 로드된다 — 즉 두 번째 문서부터는 시퀀스가
     재생되지 않는다. 그때도 CONNECTING 을 띄우면 **2초짜리 빈 연출만 보고 끝난다.**
     위젯의 플래그는 다른 출처라 읽을 수 없으므로 이쪽에 같은 수명(sessionStorage)의
     거울을 둔다. 어긋나도 손해가 없다 — 최악이 "브리지가 한 번 더/덜 뜬다" 이고,
     iframe 은 어차피 준비될 때까지 감춰져 있어 흰 프레임은 나오지 않는다. */
  const BOOT_KEY = 'amadeus_boot_seen';
  function bootSeen() { try { return sessionStorage.getItem(BOOT_KEY) === '1'; } catch (e) { return false; } }
  function markBootSeen() { try { sessionStorage.setItem(BOOT_KEY, '1'); } catch (e) {} }


  function consent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  function setConsent(v) {
    try { v === null ? localStorage.removeItem(CONSENT_KEY) : localStorage.setItem(CONSENT_KEY, v); } catch (e) {}
  }
  const granted = () => consent() === CONSENT_VERSION;

  /* preconnect — 동의 전에 깔아도 되는 유일한 접촉. 요청이 아니라 핸드셰이크다. */
  function preconnect() {
    if (document.querySelector('link[rel="preconnect"][href="' + CHAT_ORIGIN + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = CHAT_ORIGIN;
    // crossorigin 을 붙이지 않는다 — iframe 문서는 credentialed navigation 이라
    // anonymous 풀을 데우면 그 연결이 재사용되지 않는다.
    document.head.appendChild(l);
  }

  /* ── 위키 주간/야간 따라가기 (원본 그대로) ── */
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
    const u = new URL(url);
    u.searchParams.set('theme', wikiTheme());
    return u.href;
  }

  function build() {
    if (document.getElementById(ID)) return;

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
      /* iframe 은 준비되기 전까지 투명하다 — 그 동안 보이는 것은 .ac-panel 의
         배경이고, 그건 정의상 위키 팔레트와 같은 색이다. 흰 프레임이 끼어들
         자리를 아예 없앤다(원인이 about:blank 캔버스든, 커밋 직후 첫 페인트든,
         iframe 안 어디든 상관없이 막힌다).
         color-scheme 은 그래도 남긴다 — 투명 구간의 UA 캔버스까지 맞춰 둔다. */
      /* 전환(transition)을 걸지 않는다 — 배경 탭에서는 렌더가 조절돼 전환이
         진행되지 않고, 그러면 방문자가 돌아왔을 때 투명한 채로 굳어 있다.
         어차피 같은 색 위에서 드러나는 것이라 페이드가 필요 없다. */
      #${ID} .ac-frame { flex: 1; width: 100%; border: 0;
                         background: transparent; color-scheme: dark;
                         visibility: hidden; }
      #${ID} .ac-frame.ac-ready { visibility: visible; }

      /* ══ CONNECTING 브리지 ══════════════════════════════════════════
         로그인 게이트(.boot)의 첫 화면과 치수를 맞춘다. 상수는 위젯
         index.html 의 .boot-top / .boot-logo-img / .boot-sub / .boot-status
         에서 그대로 가져왔다 — 저쪽이 바뀌면 여기도 같이 바꿔야 한다. */
      #${ID} .ac-bridge {
        position: absolute; inset: 0; z-index: 1; overflow: hidden;
        background: #110D08; color: #EAE3D6;
        display: flex; align-items: center; justify-content: center;
      }
      #${ID} .ac-bridge[hidden] { display: none; }
      #${ID} .ac-bridge::before {      /* 비네트 — .boot::before */
        content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 3;
        background: radial-gradient(ellipse at center, transparent 58%, rgba(10,6,2,.5));
      }
      #${ID} .ac-bridge::after {       /* 스캔라인 — .boot::after */
        content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 4;
        background: repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px);
        opacity: .3;
      }
      #${ID} .ac-b-top {
        position: absolute; top: 16px; left: 0; right: 0; text-align: center; z-index: 2;
        font-family: 'JetBrains Mono', 'Share Tech Mono', monospace;
        font-size: 10px; letter-spacing: .42em; color: rgba(168,152,120,.5);
      }
      #${ID} .ac-b-center { position: relative; text-align: center; width: 100%; z-index: 2; }
      /* 위젯은 78vw 를 쓰지만 vw 는 그쪽에서 iframe 폭(≈390px)이고 여기서는 위키
         페이지 폭(수천 px)이다 — 그대로 옮기면 상한 440px 에 걸려 패널을 넘친다.
         컨테이너 기준 78% 로 바꿔야 저쪽과 같은 크기가 된다. */
      #${ID} .ac-b-logo {
        display: block; margin: 0 auto; width: min(440px, 78%); height: auto;
        filter: drop-shadow(0 0 30px rgba(229,184,66,.25)) drop-shadow(0 0 70px rgba(255,153,0,.12));
        opacity: 0;
      }
      #${ID} .ac-b-logo.ac-in { opacity: 1; }
      #${ID} .ac-b-sub {
        margin-top: 6px;   /* .boot-sub 와 같게 — padding 을 주면 한 줄이 접힌다 */
        font-family: 'JetBrains Mono', 'Share Tech Mono', monospace;
        font-size: 10px; letter-spacing: .34em; color: #A89878;
      }
      /* .boot-form 이 들어설 자리를 비워 둔다 — 걷힐 때 로고가 튀지 않게 */
      #${ID} .ac-b-gap { height: 112px; }
      #${ID} .ac-b-status {
        font-family: 'JetBrains Mono', 'Share Tech Mono', monospace;
        font-size: 11px; letter-spacing: .22em; color: #4ADE80;
      }
      #${ID} .ac-b-caret {
        display: inline-block; width: 7px; height: 12px; background: #E5B842;
        margin-left: 4px; vertical-align: -1px; animation: ac-blink .9s steps(1) infinite;
      }
      @keyframes ac-blink { 50% { opacity: 0; } }

      /* 동의 전에는 iframe 자리를 비워 둔다 — src 를 안 붙였으므로 about:blank 다 */
      #${ID} .ac-stage { position: relative; flex: 1; min-height: 0; display: flex; }

      /* ══ 동의 화면 ══════════════════════════════════════════════════
         로그인 게이트의 크롬만 승계한다: 바탕색·모노 헤더줄·각진 상자·골드.
         본문은 평범한 한국어 본문(14px/1.7, 산세리프)이다 — 고지가 연출에
         먹히면 informed consent 가 아니게 된다. */
      #${ID} .ac-consent {
        position: absolute; inset: 0; z-index: 2;
        background: #110D08; color: #EAE3D6;
        display: flex; flex-direction: column;
        padding: 16px 18px 18px;
        overflow-y: auto;
        transition: opacity 220ms ease;
      }
      #${ID} .ac-consent[hidden] { display: none; }
      #${ID} .ac-consent.ac-fading { opacity: 0; pointer-events: none; }

      #${ID} .ac-c-top {
        flex: none; font-family: 'JetBrains Mono', 'Share Tech Mono', monospace;
        font-size: 10px; letter-spacing: .26em; color: #A89878;
        padding-bottom: 10px; border-bottom: 1px solid rgba(229,184,66,.25);
      }
      #${ID} .ac-c-h {
        margin: 16px 0 10px; font-size: 16px; font-weight: 700; color: #E5B842;
        font-family: 'Playfair Display', Georgia, 'Noto Serif KR', serif; letter-spacing: .02em;
      }
      #${ID} .ac-c-lede { font-size: 13.5px; line-height: 1.75; color: #EAE3D6; }

      #${ID} .ac-c-list { list-style: none; margin: 14px 0 0; padding: 0;
        border: 1px solid rgba(212,222,235,.28); }
      #${ID} .ac-c-list li {
        display: grid; grid-template-columns: 72px 1fr; gap: 10px;
        padding: 9px 11px; font-size: 13px; line-height: 1.65;
        border-bottom: 1px solid rgba(212,222,235,.16);
      }
      #${ID} .ac-c-list li:last-child { border-bottom: 0; }
      #${ID} .ac-c-k {
        font-family: 'JetBrains Mono', 'Share Tech Mono', monospace;
        font-size: 10px; letter-spacing: .12em; color: #A89878;
        padding-top: 3px; text-transform: uppercase;
      }
      #${ID} .ac-c-v { color: #EAE3D6; }
      #${ID} .ac-c-note { margin-top: 12px; font-size: 12px; line-height: 1.7; color: #A89878; }
      #${ID} .ac-c-note a { color: #E5B842; }

      /* 두 버튼은 대칭이다. 한쪽만 빛나는 순간 다크패턴이 된다. */
      #${ID} .ac-c-actions {
        flex: none; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px;
      }
      #${ID} .ac-c-actions button {
        font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer;
        padding: 11px 10px; border-radius: 3px;
        background: transparent; color: #E5B842;
        border: 1px solid rgba(229,184,66,.6);
        transition: background 140ms ease;
      }
      #${ID} .ac-c-actions button:hover { background: rgba(255,153,0,.14); }
      #${ID} .ac-c-actions button:focus-visible { outline: 2px solid #E5B842; outline-offset: 2px; }

      /* ══ 주간 ══ */
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
      body[data-md-color-scheme="default"] #${ID} .ac-frame { color-scheme: light; }

      body[data-md-color-scheme="default"] #${ID} .ac-consent { background: #FFFDF6; color: #2E2A22; }
      body[data-md-color-scheme="default"] #${ID} .ac-bridge { background: #FFFDF6; color: #2E2A22; }
      body[data-md-color-scheme="default"] #${ID} .ac-bridge::before {
        background: radial-gradient(ellipse at center, transparent 62%, rgba(150,120,60,.14));
      }
      body[data-md-color-scheme="default"] #${ID} .ac-bridge::after { opacity: .06; }
      body[data-md-color-scheme="default"] #${ID} .ac-b-top { color: rgba(121,105,75,.75); }
      body[data-md-color-scheme="default"] #${ID} .ac-b-logo { filter: none; }
      body[data-md-color-scheme="default"] #${ID} .ac-b-sub { color: #79694B; }
      body[data-md-color-scheme="default"] #${ID} .ac-b-status { color: #2F7D4F; }
      body[data-md-color-scheme="default"] #${ID} .ac-b-caret { background: #8A6410; }
      body[data-md-color-scheme="default"] #${ID} .ac-c-top { color: #79694B; border-bottom-color: rgba(138,100,16,.3); }
      body[data-md-color-scheme="default"] #${ID} .ac-c-h { color: #8A6410; }
      body[data-md-color-scheme="default"] #${ID} .ac-c-lede,
      body[data-md-color-scheme="default"] #${ID} .ac-c-v { color: #2E2A22; }
      body[data-md-color-scheme="default"] #${ID} .ac-c-list { border-color: rgba(138,100,16,.32); }
      body[data-md-color-scheme="default"] #${ID} .ac-c-list li { border-bottom-color: rgba(138,100,16,.18); }
      body[data-md-color-scheme="default"] #${ID} .ac-c-k,
      body[data-md-color-scheme="default"] #${ID} .ac-c-note { color: #79694B; }
      body[data-md-color-scheme="default"] #${ID} .ac-c-note a { color: #8A6410; }
      body[data-md-color-scheme="default"] #${ID} .ac-c-actions button {
        color: #8A6410; border-color: rgba(163,74,5,.55);
      }
      body[data-md-color-scheme="default"] #${ID} .ac-c-actions button:hover { background: rgba(163,74,5,.1); }

      @media (max-width: 480px) {
        #${ID} { right: 14px; bottom: 14px; }
        #${ID} .ac-panel { height: min(560px, calc(100vh - 110px)); }
      }
      @media (prefers-reduced-motion: reduce) {
        #${ID} .ac-launcher, #${ID} .ac-panel,
        #${ID} .ac-consent { transition: none !important; }
        #${ID} .ac-b-caret { animation: none; }
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
      '<button type="button" class="ac-revoke" title="동의 철회 — 대화 기록 사용에 대한 동의를 거둡니다" ' +
      'aria-label="동의 철회" hidden>⏻</button>' +
      `<a href="${CHAT_URL}" target="_blank" rel="noopener noreferrer" class="ac-newwin" ` +
      'title="새 창에서 열기 — 대화가 확실히 이어집니다" aria-label="새 창에서 열기" hidden>↗</a>' +
      '<button type="button" class="ac-close" title="닫기" aria-label="닫기">✕</button>';

    /* iframe 과 오버레이가 같은 자리를 쓴다 */
    const stage = document.createElement('div');
    stage.className = 'ac-stage';

    const frame = document.createElement('iframe');
    frame.className = 'ac-frame';
    frame.title = '아마데우스 채팅';
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('allow', 'clipboard-write');

    /* CONNECTING 브리지 — 로그인 게이트의 첫 화면을 흉내 내 공백을 덮는다.
       로고 src 는 동의 후에야 붙는다(동의 전에는 chat 출처로 한 바이트도 안 나간다). */
    const bridge = document.createElement('div');
    bridge.className = 'ac-bridge';
    bridge.hidden = true;
    bridge.setAttribute('aria-hidden', 'true');
    bridge.innerHTML =
      '<p class="ac-b-top">AMADEUS SYSTEM — LOGIN</p>' +
      '<div class="ac-b-center">' +
        '<img class="ac-b-logo" alt="" width="490" height="336" decoding="async" fetchpriority="high">' +
        '<p class="ac-b-sub">SG-WIKI OS // AUTHENTICATION TERMINAL</p>' +
        '<div class="ac-b-gap"></div>' +
        '<p class="ac-b-status">CONNECTING<span class="ac-b-caret"></span></p>' +
      '</div>';

    /* 동의 화면 */
    const cons = document.createElement('div');
    cons.className = 'ac-consent';
    cons.hidden = true;
    cons.setAttribute('role', 'document');
    cons.innerHTML =
      '<p class="ac-c-top">AMADEUS SYSTEM — CONSENT</p>' +
      '<h2 class="ac-c-h">대화를 시작하기 전에</h2>' +
      '<p class="ac-c-lede">아마데우스와 대화하면 아래 정보가 저장됩니다. ' +
      '위키를 읽기만 할 때는 아무것도 저장하지 않습니다.</p>' +
      '<ul class="ac-c-list">' +
        '<li><span class="ac-c-k">수집</span><span class="ac-c-v">' +
          '주고받은 대화 내용, 무작위로 만들어진 식별 번호, 접속 IP·브라우저 정보' +
        '</span></li>' +
        '<li><span class="ac-c-k">목적</span><span class="ac-c-v">' +
          '이전 대화를 이어가기 위한 세션 유지, 챗봇 응답 품질 개선' +
        '</span></li>' +
        '<li><span class="ac-c-k">보관</span><span class="ac-c-v">' +
          '대화 기록 1년 · 식별 번호도 브라우저에 최대 1년' +
        '</span></li>' +
        '<li><span class="ac-c-k">국외이전</span><span class="ac-c-v">' +
          '답변 생성을 위해 <b>대화 내용이 국외(싱가포르)의 AI 모델 사업자에게 전송</b>됩니다. ' +
          '식별 번호·IP는 전송하지 않으며, 그 사업자는 받은 내용을 저장하지 않습니다' +
        '</span></li>' +
        '<li><span class="ac-c-k">철회</span><span class="ac-c-v">' +
          '창 위쪽 ⏻ 버튼을 누르면 언제든 동의를 거두고 연결을 끊을 수 있습니다' +
        '</span></li>' +
      '</ul>' +
      '<p class="ac-c-note">동의하지 않아도 위키의 모든 문서를 그대로 보실 수 있습니다. ' +
      '대화창만 열리지 않습니다. 자세한 내용은 ' +
      `<a href="${POLICY_URL}" target="_blank" rel="noopener" class="ac-c-policy">개인정보 처리방침</a>` +
      '을 확인해 주세요.</p>' +
      '<div class="ac-c-actions">' +
        '<button type="button" class="ac-c-no">거부하기</button>' +
        '<button type="button" class="ac-c-yes">동의하기</button>' +
      '</div>';

    stage.appendChild(frame);
    stage.appendChild(bridge);
    stage.appendChild(cons);

    panel.appendChild(bar);
    panel.appendChild(stage);

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

    const newwin = bar.querySelector('.ac-newwin');
    const revoke = bar.querySelector('.ac-revoke');

    /* 동의한 방문자에 한해 예전 규칙(닫아둔 선택을 기억한다)이 이어진다 */
    var PREF = 'amadeus_chat_panel';
    function pref() { try { return localStorage.getItem(PREF); } catch (e) { return null; } }
    function setPref(v) { try { localStorage.setItem(PREF, v); } catch (e) {} }

    /* ── 연결 — 동의가 있을 때만 여기 도달한다 ── */
    function connectFrame() {
      if (frame.src) return;

      /* 브리지는 로그인 시퀀스가 실제로 재생될 때 — 즉 이 탭의 첫 연결에만 올린다.
         두 번째부터는 시퀀스가 없으므로 덮을 것도 없다. iframe 은 어느 쪽이든
         준비될 때까지 감춰 두므로 그 사이에는 패널 배경만 보인다(흰 프레임 없음). */
      if (!bootSeen()) {
        const logo = bridge.querySelector('.ac-b-logo');
        if (logo && !logo.getAttribute('src')) {
          logo.addEventListener('load', () => logo.classList.add('ac-in'), { once: true });
          logo.src = CHAT_URL + 'amadeus-logo.webp';
        }
        bridge.hidden = false;
      }
      markBootSeen();
      frame.classList.remove('ac-ready');
      frame.src = withTheme(CHAT_URL);
      revealWhenReady();
    }

    /* 언제 드러낼 것인가.
       load 는 답이 아니다 — 구글 폰트·jsdelivr 까지 다 받은 뒤(실측 4.8초)에 오고,
       그때면 로그인 시퀀스가 이미 혼자 다 지나가 있다.
       대신 위젯이 이미 갖고 있는 프로토콜을 쓴다: amadeus:handoff-request 에
       답한다는 것은 head 의 테마 스크립트와 본문 스크립트가 모두 실행됐다는
       뜻이고(리스너가 그 안에서 등록된다), 그 직후가 runBoot() 이다.
       즉 "답이 왔다" = "옷을 다 입었고 시퀀스가 막 시작한다" 이다. */
    function revealWhenReady() {
      let settled = false;
      const reveal = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onPong);
        clearInterval(ping);
        clearTimeout(cap);
        /* requestAnimationFrame 을 쓰지 않는다 — 배경 탭에서는 rAF 가 아예
           돌지 않아서, 로딩 중에 탭을 옮긴 방문자는 브리지가 영영 안 걷힌다.
           페이드도 걸지 않는다(전환도 같이 멈춘다). 즉시 교체한다 —
           로고가 같은 자리 같은 크기라 이음매가 보이지 않는다. */
        frame.classList.add('ac-ready');
        bridge.hidden = true;
      };
      const onPong = (ev) => {
        if (ev.origin !== CHAT_ORIGIN) return;
        if (!ev.data || ev.data.type !== 'amadeus:handoff') return;
        reveal();
      };
      window.addEventListener('message', onPong);
      const ping = setInterval(() => {
        try {
          frame.contentWindow.postMessage({ type: 'amadeus:handoff-request' }, CHAT_ORIGIN);
        } catch (e) { /* 아직 없다 — 다음 틱에 다시 */ }
      }, 40);
      /* 답이 없는 위젯(옛 버전 등)이어도 영원히 감춰 두지는 않는다 */
      const cap = setTimeout(reveal, 2500);
    }

    function showConsent() {
      cons.hidden = false;
      cons.classList.remove('ac-fading');
      newwin.hidden = true;            // 동의 전에는 ↗ 가 게이트를 우회한다
      revoke.hidden = true;
      cons.scrollTop = 0;
      // preventScroll 없이 focus 하면 컨테이너가 버튼까지 스크롤해서
      // 헤더와 첫 문장을 건너뛴 자리에서 고지가 시작된다.
      setTimeout(() => {
        try { cons.querySelector('.ac-c-yes').focus({ preventScroll: true }); }
        catch (e) { cons.querySelector('.ac-c-yes').focus(); }
        cons.scrollTop = 0;
      }, 60);
    }

    function grant() {
      setConsent(CONSENT_VERSION);
      cons.classList.add('ac-fading');
      setTimeout(() => { cons.hidden = true; }, 240);
      newwin.hidden = false;
      revoke.hidden = false;
      setPref('open');
      connectFrame();
    }

    function deny() {
      setConsent('denied');
      cons.hidden = true;
      close(false);
    }

    /* 철회 — "쿠키를 지우세요" 라고 안내만 하는 건 실행 불가능한 안내다.
       webchat_uid 는 HttpOnly 라 스크립트가 못 지우고, 서드파티 파티션 안에 있어
       방문자가 브라우저 설정에서 찾아 지우는 것도 현실적이지 않다.
       그래서 여기서는 할 수 있는 것까지 한다: iframe 을 떼어 연결을 끊고,
       동의 플래그를 지우고, 다음 열림에서 다시 묻는다.
       ★ 남은 조각: 프록시에 Set-Cookie Max-Age=0 을 돌려주는 엔드포인트.
         그게 없으므로 처리방침 6항도 "지운다"가 아니라 "수집을 멈춘다"로 적혀 있다.
         설계는 docs/guides/ 의 챗봇 개인정보 처리 설계 문서 참고. */
    function doRevoke() {
      setConsent(null);
      frame.classList.remove('ac-ready');
      bridge.hidden = true;
      frame.removeAttribute('src');
      frame.src = 'about:blank';
      frame.removeAttribute('src');
      newwin.hidden = true;
      revoke.hidden = true;
      showConsent();
    }

    function open(remember) {
      root.classList.add('ac-open');
      launcher.setAttribute('aria-expanded', 'true');
      launcher.setAttribute('aria-label', '아마데우스 채팅 닫기');
      if (granted()) {
        cons.hidden = true;
        newwin.hidden = false;
        revoke.hidden = false;
        connectFrame();              // 첫 펼침에만 src 를 붙인다
        if (remember) setPref('open');
      } else {
        showConsent();               // iframe 은 아직 건드리지 않는다
      }
    }
    function close(remember) {
      root.classList.remove('ac-open');
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-label', '아마데우스 채팅 열기');
      if (remember && granted()) setPref('closed');
      launcher.focus();
    }

    launcher.addEventListener('click', () =>
      root.classList.contains('ac-open') ? close(true) : open(true));
    bar.querySelector('.ac-close').addEventListener('click', () => close(true));
    cons.querySelector('.ac-c-yes').addEventListener('click', grant);
    cons.querySelector('.ac-c-no').addEventListener('click', deny);
    revoke.addEventListener('click', doRevoke);

    /* 테마 전달 — iframe 이 붙기 전에는 postMessage 가 조용히 실패한다(정상) */
    function pushTheme() {
      newwin.href = withTheme(CHAT_URL);
      try {
        frame.contentWindow.postMessage({ type: 'amadeus:theme', theme: wikiTheme() }, CHAT_ORIGIN);
      } catch (e) { /* 아직 about:blank */ }
    }
    newwin.href = withTheme(CHAT_URL);
    frame.addEventListener('load', pushTheme);
    new MutationObserver(pushTheme)
      .observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });

    /* 새 창 (원본 그대로) — 동의 전에는 버튼 자체가 hidden 이라 도달하지 않는다 */
    newwin.addEventListener('click', (e) => {
      const win = window.open('', '_blank');
      if (!win) return;
      e.preventDefault();
      try { win.opener = null; } catch (err) {}
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
        serve(CHAT_URL);
      }, 350);
      try {
        frame.contentWindow.postMessage({ type: 'amadeus:handoff-request' }, CHAT_ORIGIN);
      } catch (err) {}
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('ac-open')) close(true);
    });


    /* 동의한 방문자만 예전의 "기본 펼침" 을 물려받는다.
       동의 전/거부 상태는 접힌 채로 시작한다 — 게이트가 있는 한 펼쳐도 빈 화면이다. */
    if (granted() && pref() !== 'closed') open(false);

    preconnect();
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(build);
  } else {
    document.addEventListener('DOMContentLoaded', build);
  }
})();
