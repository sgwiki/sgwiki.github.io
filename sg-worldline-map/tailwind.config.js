/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 필드색은 원전 그대로(운영자 확인 2026-10-27) — α 빨강 · β 남색 · SG 앰버.
        sg: {
          alpha: '#ef4444',      // AF_Alpha — SERN 디스토피아
          beta: '#6366f1',       // AF_Beta — WW3
          steinsgate: '#f59e0b', // AF_SteinsGate — 희망
          omega: '#6b7280',      // AF_Omega — 페이리스
        },
        shift: {
          dmail: '#3b82f6',
          presentAction: '#f97316',
          skuld: '#f59e0b',
        },
        // 앰버 CRT 크롬 — 비주얼라이저(wiki .sg-viz) 토큰
        viz: {
          bg: '#05070a',      // 화면 바탕
          panel: '#0f0b06',   // 패널/헤더
          panel2: '#171717',  // 단말 카드면
          line: '#3a2d12',    // 경계선
          linehi: '#6e5518',  // 강조 경계선
          ink: '#e6d9ac',     // 주 텍스트
          dim: '#9d8b58',     // 보조 텍스트
          amber: '#ffb000',   // 앰버
          amberhi: '#ffd257', // 밝은 앰버
        },
      },
    },
  },
  plugins: [],
}
