/*
  amadeus-chat-btn.js — 우측 하단 아마데우스 채팅 런처

  chat.flaglow.cc 를 iframe 으로 띄운다. 패널은 접었다 펼 수 있고, 기본은 접힘.

  ── 알아둘 제약 ──
  · iframe 은 지연 로드한다(첫 펼침에 src 주입). 위키 방문마다 미리 띄우면
    방문자 전원이 WS 연결을 하나씩 잡아 IP 당 동시 연결 상한을 갉아먹는다.
  · 위키(sgwiki.github.io) 안의 iframe 이므로 chat.flaglow.cc 의 쿠키·localStorage 는
    "서드파티 맥락"이 된다. Safari(ITP)는 막고 Firefox(TCP)는 파티션한다.
    → Safari 방문자는 대화가 이어지지 않는다. 그래서 헤더에 "새 창" 을 둔다 —
      거기서 열면 1차 출처라 모든 브라우저에서 정상 동작한다.
  · 이 사이트는 navigation.instant 를 쓰지 않으므로 페이지 이동 시 iframe 이 다시
    로드된다. 세션은 chat 쪽 localStorage 의 sessionKey 로 재개된다(위 제약 적용).
*/
(() => {
  const CHAT_URL = 'https://chat.flaglow.cc/';
  const ID = 'amadeus-chat-root';

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
      `<a href="${CHAT_URL}" target="_blank" rel="noopener noreferrer" ` +
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

    function open() {
      // 지연 로드: 처음 펼칠 때만 붙인다. 위키를 훑기만 하는 방문자는 연결하지 않는다.
      if (!frame.src) frame.src = CHAT_URL;
      root.classList.add('ac-open');
      launcher.setAttribute('aria-expanded', 'true');
      launcher.setAttribute('aria-label', '아마데우스 채팅 닫기');
    }
    function close() {
      root.classList.remove('ac-open');
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-label', '아마데우스 채팅 열기');
      launcher.focus();
    }

    launcher.addEventListener('click', () =>
      root.classList.contains('ac-open') ? close() : open());
    bar.querySelector('.ac-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('ac-open')) close();
    });
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(build);
  } else {
    document.addEventListener('DOMContentLoaded', build);
  }
})();
