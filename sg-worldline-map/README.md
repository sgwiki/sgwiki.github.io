# sg-worldline-map

슈타인즈 게이트 세계선, 사건, 세계선 이동, 수속 패턴을 탐색하는 인터랙티브 맵 SPA입니다. `sg-wiki` 본문 사이트와 별도로 React/Vite로 빌드하지만, 배포 시 MkDocs 산출물의 `/maps/` 하위 경로에 병합됩니다.

현재 활성 데이터셋은 `anime`입니다. `sg0` 등 추가 시리즈는 타입과 로더 구조만 준비되어 있고, 실제 JSON 데이터와 route fallback을 추가해야 노출됩니다.

## 기술 스택

- React 18
- TypeScript
- Vite
- Tailwind CSS
- D3
- GSAP

## 디렉터리 구조

```text
.
├── index.html                         SPA HTML 엔트리
├── package.json                       개발·빌드 스크립트
├── vite.config.ts                     Vite 설정 (`base: /maps/`)
├── scripts/create-spa-route-fallbacks.mjs
│                                      `/maps/anime/` 같은 하위 경로용 fallback 생성
└── src/
    ├── App.tsx                        시리즈 선택, 재생 상태, 상세 패널 조합
    ├── components/                    SVG 레이어와 UI 컴포넌트
    ├── data/                          빌드에 포함되는 정적 JSON 데이터와 로더
    ├── hooks/useD3Zoom.ts             D3 zoom/pan 훅
    ├── lib/scales.ts                  시간축, 색상, 위키 링크, 데이터 검증 유틸
    ├── playback/anime.ts              애니메이션 시리즈 재생 스크립트
    └── types/ontology.ts              generate-data.py 산출물 타입
```

## 빠른 시작

```bash
npm ci
npm run dev
```

빌드 전 검사는 다음 명령으로 실행합니다.

```bash
npm run typecheck
npm run build
```

`npm run build`는 `tsc -b`, `vite build`, `scripts/create-spa-route-fallbacks.mjs`를 순서대로 실행합니다. 빌드 결과는 `dist/`에 생성되며 git에 포함하지 않습니다.

## 데이터 갱신

앱은 런타임 API를 호출하지 않고 `src/data/*.json`을 빌드 타임에 import합니다. 이 JSON 파일들은 루트의 온톨로지 TTL에서 생성되는 배포 입력이므로 git에 포함합니다.

저장소 루트에서 실행합니다.

```bash
python scripts/generate-data.py --out sg-worldline-map/src/data
```

기본 TTL 경로는 `docker/holyclaude/ontology/src/슈타인즈게이트_온톨로지.ttl`입니다. TTL이 없거나 카운트 검증이 맞지 않으면 스크립트가 실패합니다.

## 라우팅과 배포

- Vite `base`는 `/maps/`입니다.
- 기본 진입 경로는 `/maps/`이고, 현재 명시 route fallback은 `/maps/anime/`입니다.
- 새 시리즈 경로를 추가하면 `src/data/loader.ts`의 `SERIES_ORDER`/`datasets`와 `scripts/create-spa-route-fallbacks.mjs`의 `routes`를 함께 갱신합니다.
- GitHub Actions는 SPA 산출물을 `maps-spa` artifact로 만든 뒤, MkDocs 결과물의 `site/maps/`에 복사합니다. SPA 빌드가 실패해도 위키 본문 배포는 계속됩니다.

## 개발 주의

- `src/types/ontology.ts`의 타입과 `src/data/*.json` 구조를 함께 유지합니다.
- `shift.triggeredByEventId`, `PlaybackStep.worldLineId`, `PlaybackStep.shiftId`는 JSON의 `uri`/`id`와 일치해야 강조와 재생이 동작합니다.
- `src/lib/scales.ts`의 `TIME_ZONES`는 현재 데이터 시기를 전제로 한 piecewise 시간축입니다. 데이터의 사건 시기가 늘어나면 축 구간도 갱신합니다.
- `dist/`, `node_modules/`, `*.tsbuildinfo`는 로컬 산출물이므로 커밋하지 않습니다.
