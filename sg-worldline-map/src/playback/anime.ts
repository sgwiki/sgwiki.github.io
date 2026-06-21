/**
 * 애니메이션 시리즈 "오카베 따라가기" 재생 스크립트.
 * PRD AC6: β→α→루프→취소→β→SG 선형 경로.
 *
 * 주의: worldLineId/eventId는 generate-data.py 출력의 uri 값과 정확히 일치해야 함.
 * 어긋나면 렌더링 시 해당 노드를 찾지 못함 (런타임 검증으로 체크).
 */

import type { PlaybackScript } from '@/types/ontology'

export const animePlaybackScript: PlaybackScript = {
  channels: [
    {
      id: 'main',
      labelKo: '본편 주선',
      steps: [
        {
          worldLineId: 'WL_1_130426',
          eventId: 'Event_Prologue_MetalUpa',
          captionKo:
            '2010/07/28 — 라디오 회관에서 크리스의 시신을 발견. β 1.130426%에서 시작.',
          autoAdvanceMs: 4000,
        },
        {
          worldLineId: 'WL_0_571024',
          shiftId: 'Shift_BetaToAlpha',
          eventId: 'Event_FirstDMail',
          captionKo:
            '첫 D메일이 에셜론에 포착되며 α 0.571024%로 전환. 크리스의 죽음이 사라진 대신 SERN의 시선이 향한다.',
          autoAdvanceMs: 4000,
        },
        {
          worldLineId: 'WL_0_571015',
          shiftId: 'Shift_AlphaInternal_01',
          eventId: 'Event_DMail_Loto6',
          captionKo: '로또6 D메일 → α 내부 세계선 이동 시작.',
          autoAdvanceMs: 3000,
        },
        {
          worldLineId: 'WL_0_337187',
          captionKo:
            'D메일 연쇄로 α 최심부 0.337187% 도달. 그러나 이곳에서 마유리의 죽음이 수속된다.',
          autoAdvanceMs: 4000,
        },
        {
          worldLineId: 'WL_0_337187',
          eventId: 'Event_TimeLeap_FirstUse',
          captionKo:
            '마유리를 살리기 위해 타임리프 반복. 8/13 밤, 같은 결과로 수속되는 절망의 루프.',
          autoAdvanceMs: 4500,
        },
        {
          worldLineId: 'WL_0_409431',
          shiftId: 'Shift_Alpha_337187_to_409431',
          eventId: 'Event_DMail_Cancel_SuzuhaChase',
          captionKo: 'D메일 취소 연쇄 시작 — α 밴드를 역순으로 되짚는다.',
          autoAdvanceMs: 3000,
        },
        {
          worldLineId: 'WL_0_571024',
          shiftId: 'Shift_Alpha_571046_to_571024',
          eventId: 'Event_DMail_Cancel_Loto6',
          captionKo: '마지막 D메일 취소. α 진입점 0.571024%로 복귀.',
          autoAdvanceMs: 3000,
        },
        {
          worldLineId: 'WL_1_130205',
          shiftId: 'Shift_AlphaToBeta',
          eventId: 'Event_EchelonCracking',
          captionKo:
            '다루가 에셜론의 D메일 포착 기록을 삭제. 현재 행위가 인과를 뒤흔들어 β 밴드로 재구성된다.',
          autoAdvanceMs: 4500,
        },
        {
          worldLineId: 'WL_1_130209',
          eventId: 'Event_Skuld_Fail_Travel',
          captionKo:
            '스쿨드 작전 1차 실패 — 크리스를 구하지 못하고 β 내부로 미세 이동. (온톨로지는 표시값 변동 없는 미세 이동은 별도 shift로 모델링하지 않는다.)',
          autoAdvanceMs: 3500,
        },
        {
          worldLineId: 'WL_1_048596',
          shiftId: 'Shift_BetaToSteinsGate',
          eventId: 'Event_OperationSkuldTravel',
          captionKo:
            '스쿨드 2차 성공 — 나카바치 논문이 소각되며 Steins;Gate 1.048596% 도달. α·β 어트랙터 필드 모두 벗어난다.',
          autoAdvanceMs: 0, // 마지막 단계 — 사용자 클릭 대기
        },
      ],
    },
  ],
}
