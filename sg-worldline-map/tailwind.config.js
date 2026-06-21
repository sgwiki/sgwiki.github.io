/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Material slate/deep orange 계열 (위키 테마 일관성)
        sg: {
          alpha: '#ef4444',    // AF_Alpha — SERN 디스토피아
          beta: '#6366f1',     // AF_Beta — WW3
          steinsgate: '#f59e0b', // AF_SteinsGate — 희망
          omega: '#6b7280',    // AF_Omega — 페이리스
        },
        shift: {
          dmail: '#3b82f6',
          presentAction: '#f97316',
          skuld: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
}
