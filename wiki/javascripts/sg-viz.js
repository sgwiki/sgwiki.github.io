/*
  sg-viz.js — 다이버전스 비주얼라이저(운영자 제작, tmp/ideas/steins_gate_world_line_visualizer.html
  2026-10-27 이식). 로어 데이터·캔버스 렌더러·SFX 합성기는 원본 그대로고, 표면만
  Tailwind 유틸 → 스코프 CSS(sg-theme.css .sg-viz)로 옮겼다. 이식하며 보강한 다섯 점:

  1) 마이너스 부호 — 페이리스 엔딩(-0.275349%) 표시. 원본은 7관(관=닉시 튜브) 가정이라
     부호가 숫자 관을 밀어내 마지막 자리를 먹었다. 부호는 별도 표시자로.
  2) 포인터 이벤트 — 원본 마우스 핸들러를 Pointer Events로 통합(터치 드래그 가능),
     스테이지에 touch-action:none.
  3) 드래그 후 클릭 오판정 억제 — 6px 이상 드래그하면 click 이벤트를 노드 판정에서 배제.
  4) prefers-reduced-motion — 스크램블 애니메이션·입자 유동을 생략하고 즉시 확정치.
  5) instant navigation 재진입 — rAF 루프가 마운트 이탈(canvas.isConnected=false)을 감지해
     자기 정리. resize 리스너는 1회만 바인딩.

  마운트(.sg-viz)가 없는 페이지에서는 아무 동작 없음 — 멱등(sg-enhance.js 원칙 승계).
  노트: 페이리스 엔딩 수치는 원본 0.409031%에서 위키 정전(-0.275349%, 게임 메모 서술과
  동일)으로 바로잡았다.
*/
(() => {
  // ─── 로어 데이터 ────────────────────────────────────────────────
  // 필드색은 원전 매핑(운영자 확인 2026-10-27): α 빨강 · β 남색 · SG 앰버 · γ 퍼플(외전).
  // sg-worldline-map 의 FIELD_COLOR(scales.ts)와 같은 축이다.
  const LORE_DATA = {
    alpha: {
      name: 'α FIELD (알파 어트랙터 필드)',
      divergence: '0.571024',
      desc: '마유리 사망 수속 / SERN 디스토피아 미래 확정 (0.000000% ~ 0.999999%)',
      color: '#ef4444', // Red — 원전
      nodes: [
        { id: 'a1', div: '0.571024%', name: '기본 알파 세계선', event: '마유리 사망 / SERN 습격', desc: '본편 전반부의 배경. D메일 실험으로 인해서 진입한 필드.', xRatio: 0.2, yRatio: 0.3 },
        { id: 'a2', div: '0.337187%', name: '마유리 구출 루프', event: '다양한 원인의 마유리 사망', desc: '타임리프로 아무리 과거를 바꿔도 8월 중순 마유리의 사망 수속을 피할 수 없다.', xRatio: 0.25, yRatio: 0.6 },
        { id: 'a3', div: '-0.275349%', name: '페이리스 엔딩', event: '라보 형성 무효화', desc: '페이리스 아버지를 구함으로써 아키하바라의 맹주 도시 구조가 유지되고 오카베의 인연이 변함.', xRatio: 0.15, yRatio: 0.8 }
      ]
    },
    beta: {
      name: 'β FIELD (베타 어트랙터 필드)',
      divergence: '1.130426',
      desc: '마키세 크리스 사망 수속 / 제3차 세계대전 발발 (1.000000% ~ 1.999999%)',
      color: '#6366f1', // Indigo — 원전
      nodes: [
        { id: 'b1', div: '1.130426%', name: '최초의 베타 세계선', event: '크리스 사망 목격 / 제1 D메일 발신', desc: '7월 28일 라디오 회관 옥상에서 크리스의 시체를 목격하고 알파로 이동하기 직전 상태.', xRatio: 0.5, yRatio: 0.25 },
        { id: 'b2', div: '1.130205%', name: '알파 탈출 후 베타 복귀', event: '마유리 생존 / 크리스 사망 확정', desc: 'SERN DB에서 첫 D메일을 삭제하여 마유리를 구했으나 크리스의 죽음이 다가온다.', xRatio: 0.55, yRatio: 0.55 },
        { id: 'b3', div: '1.129848%', name: '슈타인즈 게이트 제로 무대', event: '오카베의 좌절과 타임머신 군사 경쟁', desc: '크리스 구출 1차 시도 실패 후 오카베가 포기하여 2015년 제3차 세계대전으로 치닫는다.', xRatio: 0.6, yRatio: 0.85 }
      ]
    },
    sg: {
      name: 'Steins;Gate (슈타인즈 게이트)',
      divergence: '1.048596',
      desc: '어느 수속에도 구속받지 않는 미지의 미래 (1.048596%)',
      color: '#f59e0b', // Amber/Gold
      nodes: [
        { id: 'sg1', div: '1.048596%', name: '약속의 세계선 (Steins Gate)', event: '크리스 & 마유리 모두 생존 / 논문 소실', desc: '오퍼레이션 스쿨드 성공. 세계를 속여 관측을 유지하면서 수속의 사슬을 끊어낸 기적의 선.', xRatio: 0.8, yRatio: 0.5 }
      ]
    },
    gamma: {
      name: 'γ FIELD (감마 어트랙터 필드)',
      divergence: '2.615074',
      desc: '오카베가 라운더 총수가 되는 독재/외전 필드 (2.000000%대)',
      color: '#a855f7', // Purple
      nodes: [
        { id: 'g1', div: '2.615074%', name: '감마 세계선', event: '2036년 오카베의 독재자 폭정', desc: '드라마 CD/외전의 무대. 오카베 린타로가 SERN 산하 라운더의 최고 간부가 되는 거울상의 세계.', xRatio: 0.9, yRatio: 0.5 }
      ]
    }
  };

  const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONO = '"Share Tech Mono", "JetBrains Mono", monospace';

  // ─── 사운드 합성기 (원본 그대로) ────────────────────────────────
  class SoundFX {
    constructor() { this.ctx = null; this.enabled = true; }
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
    }
    playBeep(freq = 880, duration = 0.05, type = 'sine') {
      if (!this.enabled) return;
      this.init();
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) { /* AudioContext 차단 등 — 조용히 통과 */ }
    }
    playShift() {
      if (!this.enabled) return;
      for (let i = 0; i < 6; i++) {
        setTimeout(() => { this.playBeep(400 + Math.random() * 600, 0.04, 'square'); }, i * 40);
      }
    }
  }

  // ─── 초기화 (마운트 .sg-viz 1회) ────────────────────────────────
  let activeCanvas = null;
  let resizeBound = false;

  function init(root) {
    if (root.dataset.sgReady) return;
    root.dataset.sgReady = '1';

    const sfx = new SoundFX();
    let currentField = 'alpha';

    const q = (sel) => root.querySelector(sel);
    const sfxLabel = q('#sfx-label');
    const fieldBtns = root.querySelectorAll('.field-btn');
    const fieldNameEl = q('#current-field-name');
    const divDescEl = q('#divergence-desc');
    const signEl = q('#nixie-sign');
    const modal = q('#lore-modal');
    const canvas = q('#worldline-canvas');
    const ctx = canvas.getContext('2d');

    // ── SFX 토글 ──
    q('#sfx-toggle').addEventListener('click', () => {
      sfx.enabled = !sfx.enabled;
      sfxLabel.textContent = sfx.enabled ? 'SFX: ON' : 'SFX: OFF';
      if (sfx.enabled) sfx.playBeep(1000, 0.08);
    });

    // ── 닉시관 스크램블 (부호 보강) ──
    function updateNixieDisplay(targetValue) {
      let value = String(targetValue);
      let sign = '';
      if (value.startsWith('-')) { sign = '−'; value = value.slice(1); }
      signEl.textContent = sign;
      const digits = value.replace('.', '').split('');
      const elements = [
        q('#digit-0'), q('#digit-1'), q('#digit-2'),
        q('#digit-3'), q('#digit-4'), q('#digit-5'), q('#digit-6')
      ];
      if (REDUCED) {
        elements.forEach((el, idx) => { el.textContent = digits[idx] || '0'; });
        return;
      }
      sfx.playShift();
      let ticks = 0;
      const interval = setInterval(() => {
        elements.forEach((el, idx) => {
          if (ticks < 10 + idx * 2) {
            el.textContent = Math.floor(Math.random() * 10);
            el.classList.add('sg-viz__digit--spin');
          } else {
            el.textContent = digits[idx] || '0';
            el.classList.remove('sg-viz__digit--spin');
          }
        });
        ticks++;
        if (ticks > 25) clearInterval(interval);
      }, 30);
    }

    // ── 필드 전환 ──
    function setField(fieldKey) {
      currentField = fieldKey;
      const fieldData = LORE_DATA[fieldKey];
      updateNixieDisplay(fieldData.divergence);
      fieldNameEl.textContent = fieldData.name;
      divDescEl.textContent = fieldData.desc;
      fieldBtns.forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.field === fieldKey);
      });
      showNodeLore(fieldData.nodes[0]);
    }

    fieldBtns.forEach((btn) => {
      btn.addEventListener('click', () => { setField(btn.dataset.field); });
    });

    // ── 노드 정보 팝업 ──
    function showNodeLore(node) {
      q('#modal-title').textContent = node.name;
      q('#modal-divergence').textContent = node.div;
      q('#modal-event').textContent = node.event;
      q('#modal-desc').textContent = node.desc;
      modal.classList.remove('is-hidden');
    }
    q('#close-modal').addEventListener('click', () => { modal.classList.add('is-hidden'); });

    // ── 캔버스 (Pointer Events + 드래그 오판정 억제) ──
    let width, height;
    let cameraOffset = { x: 0, y: 0 };
    let isDragging = false;
    let dragDist = 0;
    let dragStart = { x: 0, y: 0 };

    function resizeCanvas() {
      if (!canvas.isConnected) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    }
    activeCanvas = canvas;
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', () => {
        if (activeCanvas && activeCanvas.isConnected) {
          const c = activeCanvas;
          c.width = c.parentElement.clientWidth;
          c.height = c.parentElement.clientHeight;
        }
      });
    }
    resizeCanvas();

    canvas.addEventListener('pointerdown', (e) => {
      isDragging = true;
      dragDist = 0;
      dragStart = { x: e.clientX - cameraOffset.x, y: e.clientY - cameraOffset.y };
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const nx = e.clientX - dragStart.x;
      const ny = e.clientY - dragStart.y;
      dragDist = Math.max(dragDist, Math.hypot(nx - cameraOffset.x, ny - cameraOffset.y));
      cameraOffset.x = nx;
      cameraOffset.y = ny;
    });
    const endDrag = () => { isDragging = false; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    q('#reset-cam').addEventListener('click', () => {
      cameraOffset = { x: 0, y: 0 };
      sfx.playBeep(600, 0.05);
    });

    // ── 입자 스트림 (매트릭스 다이버전스 낙하) ──
    const streams = [];
    const STREAM_COUNT = 60;
    for (let i = 0; i < STREAM_COUNT; i++) {
      streams.push({
        y: Math.random(),
        speed: 0.001 + Math.random() * 0.003,
        field: ['alpha', 'beta', 'sg', 'gamma'][Math.floor(Math.random() * 4)],
        char: Math.floor(Math.random() * 10).toString()
      });
    }

    // ── 메인 렌더 루프 (마운트 이탈 시 자기 정리) ──
    function render() {
      if (!canvas.isConnected) return;   // instant navigation 이탈 — 루프 종료
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(cameraOffset.x, cameraOffset.y);

      // 배경 그리드
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.3)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = -width; x < width * 2; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, -height); ctx.lineTo(x, height * 2); ctx.stroke();
      }
      for (let y = -height; y < height * 2; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(-width, y); ctx.lineTo(width * 2, y); ctx.stroke();
      }

      // 어트랙터 필드 빔(세로 광휘)
      Object.keys(LORE_DATA).forEach((key) => {
        const field = LORE_DATA[key];
        const baseX = field.nodes[0].xRatio * width;
        const isSelected = key === currentField;
        const gradient = ctx.createLinearGradient(baseX, 0, baseX, height);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(0.5, isSelected ? field.color : field.color + '33');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = isSelected ? 8 : 3;
        ctx.shadowColor = field.color;
        ctx.shadowBlur = isSelected ? 20 : 5;
        ctx.beginPath(); ctx.moveTo(baseX, 0); ctx.lineTo(baseX, height); ctx.stroke();
        ctx.shadowBlur = 0;
      });

      // 스트림 숫자 입자
      ctx.font = '12px ' + MONO;
      streams.forEach((p) => {
        if (!REDUCED) {
          p.y += p.speed;
          if (p.y > 1) p.y = 0;
        }
        const fieldNode = LORE_DATA[p.field].nodes[0];
        const px = fieldNode.xRatio * width + (Math.random() - 0.5) * 15;
        const py = p.y * height;
        ctx.fillStyle = LORE_DATA[p.field].color;
        ctx.globalAlpha = p.field === currentField ? 0.9 : 0.25;
        ctx.fillText(p.char, px, py);
      });
      ctx.globalAlpha = 1.0;

      // 사건 노드
      Object.keys(LORE_DATA).forEach((key) => {
        const field = LORE_DATA[key];
        field.nodes.forEach((node) => {
          const nx = node.xRatio * width;
          const ny = node.yRatio * height;
          const isCurrent = key === currentField;
          ctx.beginPath();
          ctx.arc(nx, ny, isCurrent ? 14 : 8, 0, Math.PI * 2);
          ctx.fillStyle = field.color;
          ctx.shadowColor = field.color;
          ctx.shadowBlur = isCurrent ? 15 : 5;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(nx, ny, isCurrent ? 20 : 12, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.font = '11px "Pretendard Variable", Pretendard, sans-serif';
          ctx.fillStyle = '#f3f4f6';
          ctx.fillText(node.div, nx + 25, ny + 4);
        });
      });

      ctx.restore();
      requestAnimationFrame(render);
    }

    // ── 노드 클릭 판정 (드래그 배제) ──
    canvas.addEventListener('click', (e) => {
      if (dragDist > 6) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left - cameraOffset.x;
      const clickY = e.clientY - rect.top - cameraOffset.y;
      Object.keys(LORE_DATA).forEach((key) => {
        LORE_DATA[key].nodes.forEach((node) => {
          const nx = node.xRatio * width;
          const ny = node.yRatio * height;
          const dist = Math.hypot(clickX - nx, clickY - ny);
          if (dist < 25) {
            setField(key);
            showNodeLore(node);
            sfx.playBeep(1200, 0.08);
          }
        });
      });
    });

    // 초기 뷰
    setField('alpha');
    requestAnimationFrame(render);
  }

  // ─── 적용 (instant navigation 대응) ──────────────────────────────
  function apply() {
    const root = document.querySelector('.sg-viz');
    if (root) init(root);
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(apply);
  } else {
    document.addEventListener('DOMContentLoaded', apply);
  }
})();
