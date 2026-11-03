// 예상 호출 시각 계산 (PRD §5.3). DB와 무관한 순수 함수로 두어 단위 테스트한다.

export interface CurrentReport {
  expectedMinutes: number;
  startedAt: Date;
}

export interface QueuedItem {
  id: number;
  expectedMinutes: number;
}

export interface Estimate {
  id: number;
  /** 내 앞에 남은 보고 수 (진행 중 포함) */
  ahead: number;
  /** 예상 대기 분. 불확실하면 null */
  etaMinutes: number | null;
}

export function estimateQueue(
  items: QueuedItem[],
  current: CurrentReport | null,
  opts: { transitionMinutes: number; certain: boolean; now: Date },
): Estimate[] {
  let elapsedBudget = 0;
  if (current) {
    const elapsed = (opts.now.getTime() - current.startedAt.getTime()) / 60000;
    // 예정보다 길어지면 최소 1분은 남은 것으로 본다.
    elapsedBudget = Math.max(1, current.expectedMinutes - elapsed) + opts.transitionMinutes;
  }
  const result: Estimate[] = [];
  let acc = elapsedBudget;
  items.forEach((item, i) => {
    result.push({
      id: item.id,
      ahead: i + (current ? 1 : 0),
      etaMinutes: opts.certain ? Math.round(acc) : null,
    });
    acc += item.expectedMinutes + opts.transitionMinutes;
  });
  return result;
}

/** 지금 줄을 서면 기다릴 시간 (홈 카드용) */
export function estimateNewJoiner(
  items: QueuedItem[],
  current: CurrentReport | null,
  opts: { transitionMinutes: number; certain: boolean; now: Date },
): number | null {
  const probe = estimateQueue([...items, { id: -1, expectedMinutes: 0 }], current, opts);
  return probe[probe.length - 1].etaMinutes;
}
