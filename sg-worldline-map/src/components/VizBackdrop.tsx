/**
 * VizBackdrop — 다이버전스 비주얼라이저(wiki/javascripts/sg-viz.js)의 캔버스
 * 렌더 루프 이식(2026-10-27). 배경 그리드 + 매트릭스 다이버전스 입자 +
 * 어트랙터 필드 빔(세로 광휘)을 데이터 맵 뒤에 깐다.
 *
 * 위상: 크롬(앰비언트)이지 데이터가 아니다 — 줌/팬과 무관한 화면 좌표계이고,
 * 필드 배치도 비주얼라이저의 정전 4필드(α/β/SG/γ) 위치·색을 그대로 쓴다.
 * 실제 세계선·밴드는 이 위에 얹히는 SVG 레이러가 담당한다.
 *
 * 이식하며 보강: reduced-motion(입자 유동·빔 점멸 정지), ResizeObserver,
 * 언마운트 정리(rAF 취소). 입자 x 지터는 원본처로 프레임마다 산포한다.
 */

import { useEffect, useRef } from 'react'

/** 필드 빔 — 위치(xRatio)는 비주얼라이저 그대로, 색은 원전 필드색
 *  (α 빨강 · β 남색 · SG 앰버 · γ 퍼플=외전, 운영자 확인 2026-10-27).
 *  데이터 맵의 FIELD_COLOR(scales.ts)와 같은 축을 쓴다. */
const FIELDS: { key: string; color: string; xRatio: number }[] = [
  { key: 'alpha', color: '#ef4444', xRatio: 0.2 },  // α 빨강
  { key: 'beta', color: '#6366f1', xRatio: 0.5 },   // β 남색
  { key: 'sg', color: '#f59e0b', xRatio: 0.8 },     // 슈타인즈 게이트 앰버
  { key: 'gamma', color: '#a855f7', xRatio: 0.9 },  // γ 퍼플(외전)
]

const STREAM_COUNT = 60

export function VizBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // 클로저(render/resize) 안에서는 TS의 null-narrowing이 유지되지 않는다 —
    // 단언으로 타입을 고정하고 런타임 가드로 실측 null 을 막는다.
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    if (!canvas || !ctx) return

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let rafId = 0
    let phase = 0

    // ── 입자 스트림 (원본 초기화 그대로 — x는 빔 위치 기준 산포라 저장하지 않는다) ──
    const streams: { y: number; speed: number; field: number; char: string }[] = []
    for (let i = 0; i < STREAM_COUNT; i++) {
      streams.push({
        y: Math.random(),
        speed: 0.001 + Math.random() * 0.003,
        field: Math.floor(Math.random() * FIELDS.length),
        char: Math.floor(Math.random() * 10).toString(),
      })
    }

    // ── 원본 render()의 그리드·빔·입자 드로잉 (노드 제외 — 데이터 맵 소관) ──
    function render() {
      if (!canvas.isConnected) return
      ctx.clearRect(0, 0, width, height)

      // 배경 그리드
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.3)'
      ctx.lineWidth = 1
      const gridSize = 40
      for (let x = -width; x < width * 2; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, -height); ctx.lineTo(x, height * 2); ctx.stroke()
      }
      for (let y = -height; y < height * 2; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(-width, y); ctx.lineTo(width * 2, y); ctx.stroke()
      }

      // 어트랙터 필드 빔 — 비주얼라이저보다 한 단계 눌러 배경으로 둔다
      if (!reduced) phase += 0.02
      const breathe = 0.5 + 0.5 * Math.sin(phase)   // 0..1 점멸
      FIELDS.forEach((f) => {
        const baseX = f.xRatio * width
        const gradient = ctx.createLinearGradient(baseX, 0, baseX, height)
        gradient.addColorStop(0, 'rgba(0,0,0,0)')
        gradient.addColorStop(0.5, f.color + '2e')
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.strokeStyle = gradient
        ctx.lineWidth = 3
        ctx.shadowColor = f.color
        ctx.shadowBlur = 5 + breathe * 3
        ctx.beginPath(); ctx.moveTo(baseX, 0); ctx.lineTo(baseX, height); ctx.stroke()
        ctx.shadowBlur = 0
      })

      // 스트림 숫자 입자 (매트릭스 다이버전스 낙하)
      ctx.font = '12px "Share Tech Mono", "IBM Plex Mono", monospace'
      streams.forEach((p) => {
        if (!reduced) {
          p.y += p.speed
          if (p.y > 1) p.y = 0
        }
        const f = FIELDS[p.field]
        const px = f.xRatio * width + (Math.random() - 0.5) * 15
        const py = p.y * height
        ctx.fillStyle = f.color
        ctx.globalAlpha = 0.22
        ctx.fillText(p.char, px, py)
      })
      ctx.globalAlpha = 1.0

      rafId = requestAnimationFrame(render)
    }

    function resize() {
      if (!canvas.isConnected) return
      const parent = canvas.parentElement
      if (!parent) return
      width = canvas.width = parent.clientWidth
      height = canvas.height = parent.clientHeight
    }

    resize()
    rafId = requestAnimationFrame(render)

    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  )
}
