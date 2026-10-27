/*
  sg-home.js — 홈(리뉴얼 B안 터미널) 전용 보조. sg-enhance.js 의 "md 무편집·멱등"
  원칙을 승계한다. 본문 페이지에는 마운트 지점이 없어 아무 것도 하지 않는다.

  1) Q&A CONSOLE: 랜덤 FAQ 대화 1건 노출(기획서 §4.2).
     · 답변은 위키 본문 요약의 캐릭터 연출 포장 — 날조 대사가 아니다.
     · 각 대화에 원문 문서 링크를 붙인다.
     · 풀은 스포일러 세이프(없음~초반 수준) 큐레이션 대상만.
     · 현재 3건은 목업(B안) 승계본 — FAQ 허브(기획서 §3.3-4·§10 미결정 6)가
       확정되면 검증된 FAQ 본문 연동 풀로 확장한다.
  2) 히어로 명령줄 검색: 입력은 장식이 아니라 Material 헤더 검색으로 인계한다.
     포커스 이동 + 입력 미러링. 인계 실패 시(검색 미지원 환경) 헤더 검색 아이콘을
     눌러 연다 — 그래도 없으면 아무 동작 없이 통과.
*/
(() => {
  // ─── 1) Q&A CONSOLE ─────────────────────────────────────────────
  // href 는 홈(/) 기준 상대 경로 — use_directory_urls 형식.
  // 규율(기획서 §4.2): 대화 본문은 스포일러 세이프하게 서술하고, 원문 문서의
  // 스포일러 배지(spoil)를 링크 옆에 미니 배지로 노출한다 — 홈(spoiler: none)에서
  // 랜덤 노출이 배지를 무력화하지 않게 하는 장치. 2026-10-27 운영자 지시로
  // 목업 3건 → 위키 FAQ 문서 참조 17건으로 확장.
  const FAQ_POOL = [
    {
      o: '자, 크리스티나! 여기 뉴비가 세계선을 모른다고 한다. 아주 쉽게 설명해주마!',
      k: '…누가 크리스티냐. 간단해 — 세계선은 세계가 흘러가는 하나의 경로야. D메일로 과거가 바뀔 때마다 경로가 갈라졌고, 그때마다 미터기의 숫자가 바뀌었지.',
      href: 'lore/세계선/',
      src: '세계선',
      spoil: 'main_story',
    },
    {
      o: '본편 완결을 봤다는군! 자, 다음에 무엇을 봐야 하는가!',
      k: '본편이 좋았다면 『슈타인즈 게이트 0』이 정석이야. 애니와 게임 어느 쪽으로 볼지는 취향이고, 순서는 시리즈 가이드에 정리돼 있어.',
      href: 'lore/시리즈-가이드/',
      src: '시리즈 가이드',
      spoil: 'main_story',
    },
    {
      o: '말하자면 D메일이란 대체 무엇인가! 라보의 자랑스러운 발명품인가!',
      k: '…그건 발명이 아니라 사고야. 전화로 보낸 메일이 과거로 도착한 것. 전화렌지(가젯)를 거치면서 일어난 우연이었고, 그게 전부의 시작이었지.',
      href: 'lore/D메일/',
      src: 'D메일',
      spoil: 'early_story',
    },
    {
      o: '신입 관측자가 도착했다! 이 위키를 어디서부터 읽어야 하는가!',
      k: '「처음 오셨나요」가 입구야. 이 위키가 무엇인지, 스포일러 배지를 읽는 법부터 정리돼 있어.',
      href: '입문/처음-오셨나요/',
      src: '처음 오셨나요',
      spoil: 'none',
    },
    {
      o: '자, 신입이 묻는다 — 애니부터인가, 게임부터인가!',
      k: '본편 애니로 시작하는 게 가장 무난한 정석이야. 시리즈 전체의 감상·플레이 순서 조합은 시청 순서 가이드가 정리하고 있어.',
      href: '커뮤니티-큐레이션/faq-애니메이션-시청-순서/',
      src: '시청 순서 가이드',
      spoil: 'main_story',
    },
    {
      o: '신입 관측자가 "몇 화부터 재미있어지냐"고 조른다! 답해주마!',
      k: '…그 질문, 커뮤니티에서 제일 많이 나오는 질문이야. 전환점까지 가보라는 쪽이 다수긴 한데, 하차 판단 논쟁까지 FAQ에 정리돼 있어.',
      href: '커뮤니티-큐레이션/슈타인즈-게이트-애니-초반-지루함-중도하차-FAQ/',
      src: '초반 지루함 FAQ',
      spoil: 'main_story',
    },
    {
      o: '크리스티나! 왜 그렇게 호칭 하나에 정색하는 거지!',
      k: '…누가 크리스티냐! 이 호칭의 유래와 C204 해석 논쟁까지 — 호칭 단독 FAQ가 따로 있으니 거기서 봐.',
      href: '커뮤니티-큐레이션/크리스티나-호칭-FAQ/',
      src: '크리스티나 호칭 FAQ',
      spoil: 'endgame',
    },
    {
      o: '엘 프사이 콩그루! 이 구호에 숨겨진 뜻을 아는 자는 없는가!',
      k: '작중에서는 특별한 의미 없는 조어로 다뤄. 팬덤의 어원 해석이 어디까지 갔는지는 FAQ에 정리돼 있어.',
      href: '커뮤니티-큐레이션/엘-프사이-콩그루-FAQ/',
      src: '엘 프사이 콩그루 FAQ',
      spoil: 'endgame',
    },
    {
      o: '우리 라보의 정예 멤버를 소개하지 않을 수 없지! 라보멘의 정원을 알려달라!',
      k: '001부터 011까지. 번호 체계나 세계선마다 달라지는 명단 혼동까지, 구성 FAQ가 정리하고 있어.',
      href: '커뮤니티-큐레이션/라보멘-구성-FAQ/',
      src: '라보멘 구성 FAQ',
      spoil: 'endgame',
    },
    {
      o: '완결을 본 관측자가 허전해 죽겠다고 한다! 이 여운, 어떻게 하는가!',
      k: '그게 이 시리즈로 유명한 감상 후유증이야. 증상과 처방은 개인 경험의 경향 정리지만, FAQ가 있어.',
      href: '커뮤니티-큐레이션/슈타인즈-게이트-감상-후유증-FAQ/',
      src: '감상 후유증 FAQ',
      spoil: 'endgame',
    },
    {
      o: 'SERN이니 IBN 5100이니 — 어디서 본 듯한 이름들이다! 우연인가!',
      k: '우연이 아니라 실존 원형의 변형이야. CERN과 IBM 5100, 존 티토까지 — 원형과 작중 변형의 차이를 정리한 FAQ가 있지.',
      href: '커뮤니티-큐레이션/faq-실존-모티브/',
      src: '실존 모티브 FAQ',
      spoil: 'main_story',
    },
    {
      o: '말하자면 SERN이란 대체 무엇인가! 수수께끼의 조직인가!',
      k: '표면은 유럽의 입자물리 연구소야. 그 이면에 무엇이 있는지는 조직 FAQ가 정리해 둘 거야.',
      href: '커뮤니티-큐레이션/SERN-FAQ/',
      src: 'SERN FAQ',
      spoil: 'main_story',
    },
    {
      o: '다들 왜 그 골동품 컴퓨터를 그렇게 찾는 거지? 뭐가 특별한가!',
      k: 'IBN 5100 — 1975년형 레트로 PC야. 희귀해져서 여러 세력이 수색하는 물건이고, 모티브는 실존 IBM 5100이지.',
      href: 'lore/IBN-5100/',
      src: 'IBN 5100',
      spoil: 'main_story',
    },
    {
      o: '왜 세계가 바뀌어도 나만 기억하고 있는 거지… 크리스, 설명해봐!',
      k: '그건 너의 능력이야. 정의와 발동 조건, 명명 유래까지 — 팬덤의 13개 질문을 정리해 뒀어.',
      href: '커뮤니티-큐레이션/리딩-슈타이너-FAQ/',
      src: '리딩 슈타이너 FAQ',
      spoil: 'endgame',
    },
    {
      o: '라보의 자랑, 미래 가젯의 위대함을 알려달라! 108가지의 지혜다!',
      k: '의미불명 발명품이 대부분이지만… 뭐, 8호기 전화렌지는 운명을 바꿨으니까. 전체 목록 문서가 있어.',
      href: 'lore/미래-가젯-목록/',
      src: '미래 가젯 목록',
      spoil: 'endgame',
    },
    {
      o: '문자 한 통 보냈을 뿐인데 세계가 통째로 바뀐다니, 이 비밀을 해명하라!',
      k: '과거로 도착한 정보가 인과 사슬을 다시 쓰기 때문이야. 세계선 변동 메커니즘 전체는 FAQ가 정리해.',
      href: '커뮤니티-큐레이션/세계선-변동-메커니즘-FAQ/',
      src: '세계선 변동 메커니즘 FAQ',
      spoil: 'endgame',
    },
    {
      o: '쥬시 가라아게 넘버원! 이 전설의 제휴 작전을 기억하는가!',
      k: '그 캠페인 얘기 아직도 하네… 커뮤니티에서도 단골 소재라 FAQ까지 있어.',
      href: '커뮤니티-큐레이션/쥬시-가라아게-넘버원-FAQ/',
      src: '쥬시 가라아게 넘버원 FAQ',
      spoil: 'main_story',
    },
  ];

  function renderFaq() {
    const mount = document.getElementById('sg-faq');
    if (!mount || mount.dataset.sgReady) return;
    mount.dataset.sgReady = '1';
    const item = FAQ_POOL[Math.floor(Math.random() * FAQ_POOL.length)];
    // 원문 배지 — 링크 대상 문서의 스포일러 배지(대화 본문이 아니라 문서의 수위)
    const badge = item.spoil && item.spoil !== 'none'
      ? ' · <span class="sg-ln__spoil sg-ln__spoil--' + item.spoil + '">[' + item.spoil + ']</span>'
      : '';
    mount.innerHTML =
      '<div class="sg-ln sg-ln--okabe"><span class="sg-ln__who">Okabe&gt;</span>' +
      '<div class="sg-ln__body">' + item.o + '</div></div>' +
      '<div class="sg-ln sg-ln--kurisu"><span class="sg-ln__who">Kurisu&gt;</span>' +
      '<div class="sg-ln__body">' + item.k +
      '<span class="sg-ln__src">&gt; 원문: <a href="' + item.href + '">' + item.src + '</a> 문서' + badge + '</span>' +
      '</div></div>';
  }

  // ─── 2) 히어로 명령줄 검색 → Material 헤더 검색 인계 ────────────
  function wireCmdSearch() {
    const input = document.querySelector('.sg-cmdsearch input');
    if (!input || input.dataset.sgReady) return;
    input.dataset.sgReady = '1';
    const realInput = () => document.querySelector('.md-header .md-search__input');

    input.addEventListener('focus', () => {
      const real = realInput();
      if (real) {
        real.focus({ preventScroll: true });
      } else {
        const icon = document.querySelector('.md-header .md-search__icon');
        if (icon) icon.click();
      }
    });
    input.addEventListener('input', () => {
      const real = realInput();
      if (!real) return;
      real.value = input.value;
      // 프로그래밍 대입은 이벤트를 못 낳는다 — Material 리스너가 들을 수 있게 재발사.
      real.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  // ─── 적용 (instant navigation 대응) ──────────────────────────────
  function apply() {
    renderFaq();
    wireCmdSearch();
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(apply);   // Material 인스턴트 내비게이션 대응
  } else {
    document.addEventListener('DOMContentLoaded', apply);
  }
})();
