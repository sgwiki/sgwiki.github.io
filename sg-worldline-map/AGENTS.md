# AGENTS.md

이 파일은 `sg-worldline-map/` 하위 작업에 적용되는 로컬 지침입니다. 상위 `AGENTS.md`의 위키·파이프라인 규칙을 함께 따릅니다.

## 프로젝트 개요

`sg-worldline-map`은 `sg-wiki`의 `/maps/` 경로에 병합 배포되는 React/Vite 기반 세계선 인터랙티브 맵입니다. 런타임 백엔드 없이 `src/data/*.json`을 정적으로 import해 SVG 레이어로 렌더링합니다.

## 핵심 명령

```bash
npm run dev          # Vite 개발 서버
npm run typecheck    # TypeScript project build 검사
npm run build        # typecheck + Vite build + route fallback 생성
```

데이터 재생성은 저장소 루트에서 실행한다.

```bash
python scripts/generate-data.py --out sg-worldline-map/src/data
```

## 주요 파일

| 경로 | 역할 |
|---|---|
| `src/App.tsx` | URL 기반 시리즈 선택, 재생 강조 상태, 상세 패널 조합 |
| `src/components/WorldLineMap.tsx` | SVG 루트, D3 zoom/pan, 레이어 조합, 강조 상태 |
| `src/components/*Layer.tsx` | 밴드, 세계선, 전환, 사건, 수속 레이어 |
| `src/data/loader.ts` | tracked JSON import와 시리즈 registry |
| `src/data/*.json` | `generate-data.py` 산출물이자 배포 입력 |
| `src/lib/scales.ts` | 시간축, 색상, 위키 링크, 데이터 무결성 검사 |
| `src/playback/anime.ts` | "시나리오 재생" 단계 정의 |
| `scripts/create-spa-route-fallbacks.mjs` | `/maps/<route>/` 직접 접근 fallback 생성 |

## 변경 규칙

- 새 dependency를 추가하지 말고, 기존 React/D3/GSAP/Tailwind 구조를 우선 사용한다.
- `src/data/*.json`은 생성물이지만 tracked 배포 입력이다. 데이터 내용을 수동 보정해야 하면 근거를 남기고, 가능하면 루트 `scripts/generate-data.py`에서 생성 원인을 고친다.
- `dist/`, `node_modules/`, `dist-tsbuildinfo/`, `*.tsbuildinfo`는 커밋하지 않는다.
- `vite.config.ts`의 `base: '/maps/'`, `index.html`의 `/maps/favicon.svg`, GitHub Pages 병합 경로는 서로 연결되어 있다. 경로를 바꿀 때 세 곳과 배포 workflow를 함께 확인한다.
- 시리즈를 추가할 때 `SERIES_ORDER`, `SERIES_LABELS`, `datasets`, route fallback 목록, 필요 시 playback script를 함께 갱신한다.
- `TIME_ZONES` 밖의 사건은 시간축 gap에 걸릴 수 있다. 새 시기 데이터가 들어오면 `src/lib/scales.ts`의 구역 정의를 먼저 검토한다.
- 시각 변경은 데스크톱과 모바일 높이에서 텍스트 겹침, 패널 위치, SVG 클릭/줌 동작을 확인한다.

## 검증

문서만 바꾼 경우에도 최소한 경로와 명령명이 실제 파일과 맞는지 확인한다. 코드, 데이터, 라우팅을 바꾼 경우 `npm run typecheck`와 `npm run build`를 실행하고 결과를 보고한다.
