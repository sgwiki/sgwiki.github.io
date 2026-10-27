/**
 * SoundFX — 레트로 효과음 합성기.
 *
 * 위키 다이버전스 비주얼라이저(wiki/javascripts/sg-viz.js)의 SoundFX 클래스 이식
 * (2026-10-27, 운영자 지시 — 세계선 테마를 비주얼라이저 스타일로 통일).
 * 로직은 원본 그대로: Web Audio 오실레이터 + 지수 페이드. AudioContext는 사용자
 * 제스처가 있어야 생성되므로 playBeep 첫 호출(클릭 계열)에서 지연 초기화된다.
 * 실패(자동재생 정책 등)는 조용히 통과 — 소리가 UI를 깨지 않게.
 */

export class SoundFX {
  private ctx: AudioContext | null = null
  enabled = true

  private init() {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC) this.ctx = new AC()
    }
  }

  playBeep(freq = 880, duration = 0.05, type: OscillatorType = 'sine') {
    if (!this.enabled) return
    this.init()
    if (!this.ctx) return
    try {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime)
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + duration)
    } catch {
      // AudioContext 차단 등 — 조용히 통과
    }
  }

  /** 세계선 이동 — 비주얼라이저의 급변 시퀀스(고주파 스퀘어 6연타) 그대로. */
  playShift() {
    if (!this.enabled) return
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        this.playBeep(400 + Math.random() * 600, 0.04, 'square')
      }, i * 40)
    }
  }
}

/** 앱 전역 1인스턴스 — 토글 상태가 뷰 전환에도 유지된다. */
export const sfx = new SoundFX()
