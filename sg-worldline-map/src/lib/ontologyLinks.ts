/**
 * 온톨로지 ID → 위키 페이지 URL 리졸버 (P0-5).
 * WorldLine은 기존 wikiSlug 직링크, 그 외 노드는 node_wiki_refs.json의
 * 언급수 랭킹을 사용한다. 무언급 노드는 null (우아한 degrade).
 */

import type { GraphNode, WikiRef } from '@/types/ontology'
import { graphDataset } from '@/data/loader'

/** 위키 문서 상대경로("lore/타임머신-모델") → 사이트 절대 URL. MkDocs directory URL 규칙. */
export function wikiPageUrl(path: string): string {
  return `/${path}/`
}

/** 이 개체를 언급하는 위키 문서 목록 (언급수 내림차순). 없으면 빈 배열. */
export function wikiRefsFor(nodeId: string): WikiRef[] {
  return graphDataset.wikiRefs[nodeId] ?? []
}

/** 대표 위키 링크 — WorldLine은 wikiSlug, 그 외는 최다 언급 문서. 없으면 null. */
export function primaryWikiUrl(node: GraphNode): string | null {
  if (node.class === 'WorldLine' && node.wikiSlug) {
    return `/세계선/${node.wikiSlug}/`
  }
  const refs = wikiRefsFor(node.id)
  return refs.length > 0 ? wikiPageUrl(refs[0].path) : null
}
