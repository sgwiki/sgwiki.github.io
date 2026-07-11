/**
 * 부분그래프 유틸 — embed 모드(1홉 이웃)와 포커스 강조에 사용.
 */

import type { GraphEdge, GraphNode } from '@/types/ontology'

export interface Subgraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** centerId의 n홉 이웃 부분그래프. center가 없으면 빈 그래프. */
export function neighborhood(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerId: string,
  hops = 1,
): Subgraph {
  if (!nodes.some((n) => n.id === centerId)) return { nodes: [], edges: [] }
  const keep = new Set<string>([centerId])
  let frontier = new Set<string>([centerId])
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>()
    for (const e of edges) {
      if (frontier.has(e.source) && !keep.has(e.target)) next.add(e.target)
      if (frontier.has(e.target) && !keep.has(e.source)) next.add(e.source)
    }
    next.forEach((id) => keep.add(id))
    frontier = next
  }
  return {
    nodes: nodes.filter((n) => keep.has(n.id)),
    edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  }
}

/** 인접 노드 id 집합 맵 (hover 이웃 강조용) */
export function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a)!.add(b)
  }
  for (const e of edges) {
    add(e.source, e.target)
    add(e.target, e.source)
  }
  return adj
}
