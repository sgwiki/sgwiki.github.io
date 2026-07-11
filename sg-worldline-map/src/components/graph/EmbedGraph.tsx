/**
 * 위키 임베드 모드 (P2-2) — /maps/?view=graph&focus=<id>&embed=1&theme=<light|dark>
 * 포커스 노드의 1홉 이웃만, 크롬 최소로 렌더. iframe(sg-enhance.js가 주입)에 담긴다.
 * 노드 클릭 = 해당 노드로 재포커스(iframe 내부 탐색), 하단 링크 = 전역 그래프(target=_top).
 */

import { useMemo, useState } from 'react'
import { graphDataset } from '@/data/loader'
import { GraphView, type GraphTheme } from './GraphView'
import { neighborhood } from './subgraph'
import { nodeLabel, CLASS_LABEL_KO } from './nodeStyles'

interface Props {
  initialFocus: string | null
  theme: GraphTheme
}

export function EmbedGraph({ initialFocus, theme }: Props) {
  const [focus, setFocus] = useState<string | null>(initialFocus)
  const { nodes, edges } = graphDataset

  const sub = useMemo(
    () => (focus ? neighborhood(nodes, edges, focus, 1) : { nodes: [], edges: [] }),
    [nodes, edges, focus],
  )
  const focusNode = focus ? nodes.find((n) => n.id === focus) ?? null : null

  const dark = theme === 'dark'
  const chrome = dark
    ? { bg: '#0A1525', border: '#152240', text: '#C0D8F0', sub: '#4A6A8A' }
    : { bg: '#eef2f7', border: '#d3dce6', text: '#1e293b', sub: '#64748b' }

  if (!focusNode) {
    return (
      <div
        className="w-full h-screen flex items-center justify-center text-sm"
        style={{ background: chrome.bg, color: chrome.sub }}
      >
        온톨로지 노드를 찾을 수 없습니다{focus ? `: ${focus}` : ''}
      </div>
    )
  }

  return (
    <div className="w-full h-screen flex flex-col">
      <div className="flex-1 min-h-0">
        <GraphView
          nodes={sub.nodes}
          edges={sub.edges}
          mode="embed"
          theme={theme}
          focusNodeId={focus}
          selectedNodeId={focus}
          onNodeClick={(n) => setFocus(n.id)}
        />
      </div>
      <div
        className="flex items-center justify-between px-3 py-1.5 text-xs border-t"
        style={{ background: chrome.bg, borderColor: chrome.border }}
      >
        <span style={{ color: chrome.sub }} className="truncate">
          <span style={{ color: chrome.text }}>{nodeLabel(focusNode)}</span>
          {' · '}
          {CLASS_LABEL_KO[focusNode.class]} · 1홉 이웃 {Math.max(sub.nodes.length - 1, 0)}개
        </span>
        <a
          href={`/maps/?view=graph&focus=${encodeURIComponent(focusNode.id)}`}
          target="_top"
          className="flex-shrink-0 ml-3 font-medium hover:underline"
          style={{ color: '#FF8C00' }}
        >
          전체 그래프에서 열기 →
        </a>
      </div>
    </div>
  )
}
