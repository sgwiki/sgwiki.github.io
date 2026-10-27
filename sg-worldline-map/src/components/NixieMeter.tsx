/**
 * NixieMeter — 다이버전스 닉시관 미터.
 *
 * 위키 다이버전스 비주얼라이저(sg-viz.js)의 updateNixieDisplay 스크램블 이식
 * (2026-10-27). 값이 바뀌면 슬롯머신처럼 굴러가며 확정된다 — 로직(틱당
 * 10+idx*2 회 노이즈 → 확정치)과 부호 처리('-' → 별도 표시자)는 원본 그대로.
 * 스타일은 index.css 의 .viz-nixie-* (비주얼라이저 .sg-viz__digit 포팅).
 *
 * reduced-motion 이면 스크램블 없이 즉시 확정.
 */

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** '1.048596' 형식(부호 없음) 또는 null(자리 비움 '--------') */
  value: string | null
  /** 튜브 크기 — 헤더용 compact */
  compact?: boolean
}

const DIGITS = 7

export function NixieMeter({ value, compact = false }: Props) {
  const [display, setDisplay] = useState<string[]>(() => idleDigits())
  const prev = useRef<string | null>(null)

  useEffect(() => {
    const target = normalize(value)
    if (prev.current === target) return
    const from = prev.current
    prev.current = target

    if (target === null) {
      setDisplay(idleDigits())
      return
    }

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    // 부호('-')는 별도 표시자가 담당 — 관(튜브) 7자리는 숫자만 쓴다(sg-viz와 동일 규약)
    const final = target.replace('-', '').replace('.', '').split('')
    if (reduced || from === null) {
      setDisplay(Array.from({ length: DIGITS }, (_, i) => final[i] ?? '0'))
      return
    }

    // ── 스크램블(원본 알고리즘) ──
    let ticks = 0
    const interval = window.setInterval(() => {
      setDisplay(
        Array.from({ length: DIGITS }, (_, idx) =>
          ticks < 10 + idx * 2
            ? String(Math.floor(Math.random() * 10))
            : (final[idx] ?? '0')
        )
      )
      ticks++
      if (ticks > 25) window.clearInterval(interval)
    }, 30)
    return () => window.clearInterval(interval)
  }, [value])

  const sign = value && value.startsWith('-') ? '−' : ''
  const [intPart, ...rest] = (value ?? '').replace('-', '').split('.')
  const fracPart = rest.join('')

  return (
    <div className={`viz-nixie ${compact ? 'viz-nixie--compact' : ''}`} role="img"
      aria-label={`다이버전스 ${value ?? '미정'}%`}>
      <span className="viz-nixie__sign" aria-hidden="true">{sign}</span>
      <span className="viz-nixie__tube" aria-hidden="true">{display[0] ?? intPart[0] ?? '0'}</span>
      <span className="viz-nixie__dot" aria-hidden="true">.</span>
      {Array.from({ length: DIGITS - 1 }, (_, i) => (
        <span key={i} className="viz-nixie__tube" aria-hidden="true">
          {display[i + 1] ?? fracPart[i] ?? '0'}
        </span>
      ))}
      <span className="viz-nixie__pct" aria-hidden="true">%</span>
    </div>
  )
}

function normalize(value: string | null): string | null {
  if (value == null) return null
  const v = value.trim()
  if (!v) return null
  return v
}

function idleDigits(): string[] {
  return Array.from({ length: DIGITS }, () => '-')
}
