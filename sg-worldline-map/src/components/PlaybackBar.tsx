/**
 * "오카베 따라가기" 재생 바.
 * - 애니메이션: 단일 채널 linear 재생
 * - S;G0: 루트 선택 후 해당 채널 재생 (현재 sg0 데이터 미지원 — 데이터 추가 시 자동 활성화)
 * AC6: 단계별 자동/수동 진행, 현재 단계 캡션 표시.
 */

import { useEffect, useRef, useState } from 'react'
import type { PlaybackChannel, PlaybackStep, SeriesDataset } from '@/types/ontology'

interface Props {
  dataset: SeriesDataset
  onStepChange: (step: PlaybackStep | null) => void
}

export function PlaybackBar({ dataset, onStepChange }: Props) {
  const script = dataset.playbackScript
  const [channel, setChannel] = useState<PlaybackChannel | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const timerRef = useRef<number | null>(null)

  // 첫 채널 자동 선택
  useEffect(() => {
    if (script && script.channels.length > 0 && !channel) {
      setChannel(script.channels[0])
    }
  }, [script, channel])

  // 현재 단계 전달
  useEffect(() => {
    if (channel && playing) {
      onStepChange(channel.steps[stepIdx] ?? null)
    } else if (!playing) {
      onStepChange(null)
    }
  }, [channel, stepIdx, playing, onStepChange])

  // 자동 진행 타이머
  useEffect(() => {
    if (!playing || !channel) return
    const step = channel.steps[stepIdx]
    if (!step) {
      setPlaying(false)
      return
    }
    if (step.autoAdvanceMs && step.autoAdvanceMs > 0) {
      timerRef.current = window.setTimeout(() => {
        setStepIdx((i) => Math.min(i + 1, channel.steps.length - 1))
      }, step.autoAdvanceMs)
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [playing, channel, stepIdx])

  if (!script || !channel) {
    return null // 이 시리즈는 재생 스크립트 미지원
  }

  const atEnd = stepIdx >= channel.steps.length - 1

  const handlePlay = () => {
    setShowPanel(true)
    if (atEnd) {
      setStepIdx(0)
    }
    setPlaying(true)
  }

  const handlePause = () => setPlaying(false)

  const handleNext = () => {
    setStepIdx((i) => Math.min(i + 1, channel.steps.length - 1))
  }

  const handlePrev = () => {
    setStepIdx((i) => Math.max(i - 1, 0))
  }

  // S;G0 루트 선택 (routes 있는 경우)
  const routes = script.routes
  const currentStep = channel.steps[stepIdx]

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(90%,720px)]">
      {routes && (
        <div className="mb-2 flex gap-2 justify-center">
          {routes.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                const ch = script.channels.find((c) => c.id === r.channelId)
                if (ch) {
                  setChannel(ch)
                  setStepIdx(0)
                }
              }}
              className={`px-3 py-1 rounded text-xs border transition-colors ${
                channel.id === r.channelId
                  ? 'bg-[#C25200] text-white border-[#FF8C00]/60'
                  : 'bg-[#0A1525] text-[#4A6A8A] border-[#152240] hover:border-[#4A6A8A] hover:text-[#C0D8F0]'
              }`}
            >
              {r.labelKo}
            </button>
          ))}
        </div>
      )}

      <div className="bg-[#0A1525]/98 backdrop-blur border border-[#152240] rounded-lg p-3 shadow-2xl">
        {showPanel && currentStep ? (
          <>
            <p className="text-sm text-[#C0D8F0] leading-relaxed mb-2 min-h-[3em]">
              {currentStep.captionKo}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={handlePrev} disabled={stepIdx === 0} className="control-btn">
                ⏮
              </button>
              {playing ? (
                <button onClick={handlePause} className="control-btn-primary">⏸ 일시정지</button>
              ) : (
                <button onClick={handlePlay} className="control-btn-primary">▶ 재생</button>
              )}
              <button onClick={handleNext} disabled={atEnd} className="control-btn">
                ⏭
              </button>
              <button onClick={() => { setShowPanel(false); setPlaying(false); onStepChange(null) }} className="control-btn ml-auto">
                ✕ 닫기
              </button>
              <span className="text-xs text-[#4A6A8A] ml-2">
                {stepIdx + 1} / {channel.steps.length}
              </span>
            </div>
            {/* 진행 바 */}
            <div className="mt-2 h-1 bg-[#152240] rounded overflow-hidden">
              <div
                className="h-full bg-[#C25200] transition-all duration-300"
                style={{ width: `${((stepIdx + 1) / channel.steps.length) * 100}%` }}
              />
            </div>
          </>
        ) : (
          <button onClick={handlePlay} className="w-full py-2 text-sm text-[#A0B8CC] hover:text-[#C0D8F0] transition-colors">
            ▶ "{channel.labelKo ?? '오카베 따라가기'}" 시작하기
          </button>
        )}
      </div>

      <style>{`
        .control-btn { padding: 4px 10px; background: #0A1525; color: #A0B8CC; border-radius: 4px; font-size: 14px; border: 1px solid #152240; cursor: pointer; }
        .control-btn:hover { background: #152240; color: #C0D8F0; }
        .control-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .control-btn-primary { padding: 4px 14px; background: #C25200; color: white; border-radius: 4px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .control-btn-primary:hover { filter: brightness(1.15); }
      `}</style>
    </div>
  )
}
