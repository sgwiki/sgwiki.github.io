/**
 * 시리즈 데이터셋 로더.
 * generate-data.py가 출력한 7개 JSON을 묶어 SeriesDataset으로 제공.
 *
 * PRD M3.1: 시리즈 분기는 generate-data.py에서 --series 옵션으로 처리되지만,
 * SPA는 빌드 타임에 모든 시리즈 JSON을 import하여 정적으로 묶는다.
 * (런타임 fetch 회피 — GitHub Pages 정적 호스팅)
 *
 * 시리즈 추가 절차 (vn/elite/movie 등):
 *   1. generate-data.py --series <id> 로 JSON 생성 (src/data/<id>/*.json)
 *   2. 아래 datasets 맵에 엔트리 추가
 *   3. (필요 시) playbackScript.ts에 재생 스크립트 추가
 */

import type { GraphDataset, SeriesDataset, SeriesId } from '@/types/ontology'

// anime 시리즈 JSON (Phase 0 산출)
import animeWorldlines from '@/data/worldlines.json'
import animeEvents from '@/data/events.json'
import animeShifts from '@/data/shifts.json'
import animeVariations from '@/data/variations.json'
import animeMacroEvents from '@/data/macro_events.json'
import animeConvergence from '@/data/convergence.json'
import animeBands from '@/data/bands.json'
import { animePlaybackScript } from '@/playback/anime'

// 온톨로지 그래프 뷰 JSON (시리즈 무관 — TTL 전체 엔티티)
import graphNodes from '@/data/graph_nodes.json'
import graphEdges from '@/data/graph_edges.json'
import nodeWikiRefs from '@/data/node_wiki_refs.json'

export const graphDataset: GraphDataset = {
  nodes: graphNodes as never,
  edges: graphEdges as never,
  wikiRefs: nodeWikiRefs as never,
}

export const SERIES_ORDER: SeriesId[] = ['anime']

export const SERIES_LABELS: Record<string, string> = {
  anime: '슈타인즈 게이트 (애니메이션)',
  sg0: 'Steins;Gate 0 (게임)',
}

export const datasets: Record<string, SeriesDataset> = {
  anime: {
    series: 'anime',
    seriesLabelKo: SERIES_LABELS.anime,
    worldlines: animeWorldlines as never,
    events: animeEvents as never,
    shifts: animeShifts as never,
    variations: animeVariations as never,
    macroEvents: animeMacroEvents as never,
    convergence: animeConvergence as never,
    bands: animeBands as never,
    playbackScript: animePlaybackScript,
  },
  // sg0: holyclaude 팀 S;G0 저작 완료 후 추가 (PRD Lane 2)
}

/**
 * URL 파라미터 / 경로에서 시리즈 결정.
 * 유효하지 않은 시리즈면 첫 번째(anime)로 fallback.
 */
export function resolveSeries(seriesParam: string | null | undefined): SeriesId {
  if (seriesParam && datasets[seriesParam]) {
    return seriesParam as SeriesId
  }
  return SERIES_ORDER[0]
}

export function getDataset(series: SeriesId): SeriesDataset {
  const ds = datasets[series]
  if (!ds) {
    // 빌드 시점에 시리즈가 datasets에 없으면 anime로 fallback (런타임 안전)
    return datasets.anime
  }
  return ds
}
