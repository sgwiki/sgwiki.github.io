/**
 * 온톨로지 TTL 스키마에서 파생된 TypeScript 타입.
 * `scripts/generate-data.py`의 JSON 출력과 1:1 대응.
 *
 * 시리즈 추상화 (PRD M1.2 동기화 게이트):
 *   모든 시리즈 데이터셋은 `SeriesDataset` 인터페이스를 만족한다.
 *   시리즈별로 WorldLine/Event/Shift의 인스턴스 수는 다르지만 구조는 동일.
 *   S;G0 데이터(holyclaude 팀 저작)가 나중에 들어와도 이 인터페이스가 깨지지 않도록 설계.
 */

// ─── 어트랙터 필드 ──────────────────────────────────────────────────
export type AttractorFieldId =
  | 'AF_Alpha'
  | 'AF_Beta'
  | 'AF_SteinsGate'
  | 'AF_Omega'
  | (string & {}) // 향후 시리즈에서 새 AF 추가 허용

export interface AttractorBand {
  id: AttractorFieldId
  labelKo: string
  color: string
  yTop: number
  yBottom: number
}

// ─── 핵심 엔티티 ──────────────────────────────────────────────────────
export interface WorldLine {
  id: string          // "WL_0_571024"
  uri: string         // RDF URI 마지막 세그먼트 (id와 동일한 경우 많음)
  labelKo: string
  divergence: number  // % 값 (음수 가능 — Omega)
  isActive: boolean
  attractorField: AttractorFieldId
  y: number           // SVG Y 좌표 (generate-data.py에서 계산)
}

export type EventType =
  | 'actual'
  | 'intervention'
  | 'communication'
  | 'travel'
  | 'death'
  | (string & {})

export type MechanismType =
  | 'dmail'
  | 'timeleap'
  | 'physicaltravel'
  | 'videodmail'
  | 'none'
  | (string & {})

export interface SGEvent {
  id: string
  uri: string
  labelKo: string
  summary: string
  eventType: EventType
  mechanismType: MechanismType
  localDateTime: string   // "YYYY-MM-DD HH:MM"
  timePrecision: 'exact' | 'approximate' | 'day' | 'unknown'
  place: string | null
  actor: string | null    // "Char_Okabe" 형태
  target: string | null
  variationId: string
  worldLineId: string     // 2홉 평탄화 결과
  macroEventId: string
}

export interface WorldLineShift {
  id: string
  uri: string
  shiftType: string       // 'dmail' | 'presentAction' | 'physicaltravel+videodmail' | ...
  shiftMoment: string     // "YYYY-MM-DD HH:MM"
  summary: string
  fromWorldLineId: string
  toWorldLineId: string
  fromY: number           // generate-data.py에서 조인
  toY: number
  triggeredByEventId: string
}

export interface EventVariation {
  id: string
  uri: string
  variationIdentity: string
  branchCondition: string | null
  worldLineId: string
  macroEventId: string
}

export interface MacroEvent {
  id: string
  uri: string
  labelKo: string
}

export interface ConvergencePattern {
  id: string
  uri: string
  labelKo: string
  description: string
  timeWindow: string      // "2010-08-13 night", "2034" 등 자유 문자열
  appliesToCharacter: string | null  // "Mayuri" 등 (Char_ 접두어 제거됨)
  attractorField: AttractorFieldId | ''
  /** 2010년대 날짜/구간이면 true → 타임라인 상 음영 가능. 연도만 있으면 false → 밴드 라벨. */
  onTimeline: boolean
}

// ─── 시리즈 데이터셋 (generate-data.py 출력 묶음) ────────────────────
export interface SeriesDataset {
  series: SeriesId
  seriesLabelKo: string
  worldlines: WorldLine[]
  events: SGEvent[]
  shifts: WorldLineShift[]
  variations: EventVariation[]
  macroEvents: MacroEvent[]
  convergence: ConvergencePattern[]
  bands: AttractorBand[]
  /** "오카베 따라가기" 재생 스크립트 — 시리즈별. 애니는 선형, S;G0은 루트 분기 트리. */
  playbackScript?: PlaybackScript
}

export type SeriesId =
  | 'anime'    // 슈타인즈 게이트 애니메이션
  | 'sg0'      // Steins;Gate 0 게임
  | (string & {}) // 향후: vn(원작 게임), elite_game, elite_anime, movie

// ─── 재생 스크립트 ────────────────────────────────────────────────────
/**
 * "오카베 따라가기" 모드용 스크립트.
 * - 애니메이션: 단일 linear 채널 (β→α→루프→취소→β→SG)
 * - S;G0: routeTrees 로 분기 (사용자가 루트 선택 → 해당 트리 재생)
 */
export interface PlaybackScript {
  /** 애니메이션은 단일 채널. S;G0은 routeId별 다중 채널. */
  channels: PlaybackChannel[]
  /** S;G0 전용: 루트 선택 옵션. 없으면 단일 linear. */
  routes?: PlaybackRoute[]
}

export interface PlaybackChannel {
  id: string
  routeId?: string     // S;G0 루트 분기 시
  labelKo?: string
  /** 이 채널의 재생 단계 순서. 각 단계는 세계선 강조 + 선택적 전환 애니메이션. */
  steps: PlaybackStep[]
}

export interface PlaybackStep {
  /** 강조할 세계선 (또는 이벤트) */
  worldLineId?: string
  eventId?: string
  /** 이전 단계에서 현재로의 전환 (있으면 곡선 애니메이션) */
  shiftId?: string
  captionKo: string
  /** 자동 진행 전 대기 (ms). 미지정 시 사용자 클릭 대기. */
  autoAdvanceMs?: number
}

export interface PlaybackRoute {
  id: string
  labelKo: string
  channelId: string   // 이 루트가 가리키는 channel
}

// ─── 렌더링 계산 타입 ─────────────────────────────────────────────────
export interface MapScales {
  /** localDateTime "YYYY-MM-DD HH:MM" → X 픽셀 */
  x: (dt: string) => number
  /** X 범위 */
  xDomain: [Date, Date]
  width: number
  height: number
}
