// 生理周期予測ユーティリティ

export type CycleRecord = {
  startDate: Date;
  endDate: Date | null;
};

export type CyclePrediction = {
  avgCycleLength: number;    // 平均周期日数
  avgPeriodLength: number;   // 平均経血日数
  nextPeriodStart: Date;     // 次回生理予測開始日
  nextPeriodEnd: Date;       // 次回生理予測終了日
  pmsStart: Date;            // PMS開始予測（生理7日前）
  pmsPeak: Date;             // PMSピーク予測（生理3日前）
  goldenStart: Date;         // ダイエット黄金期開始（生理終了翌日）
  goldenEnd: Date;           // ダイエット黄金期終了（排卵2日前目安）
};

export type CyclePhaseType =
  | "pms_start"      // PMS開始（生理7日前）
  | "pms_peak"       // PMSピーク（生理3日前）
  | "period_check"   // 生理予測日当日（来たか確認）
  | "period_overdue" // 予測日を過ぎても未確認
  | "period_active"  // 生理中
  | "period_end"     // 生理明け当日
  | "golden"         // ダイエット黄金期
  | "normal";        // 通常期

export type CyclePhase = {
  type: CyclePhaseType;
  dayOfPhase: number;  // フェーズ内の何日目か（1始まり）
  prediction: CyclePrediction;
};

const DEFAULT_CYCLE_LENGTH = 28;
const DEFAULT_PERIOD_LENGTH = 5;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function predictNextCycle(cycles: CycleRecord[]): CyclePrediction | null {
  if (cycles.length === 0) return null;

  // 最新の周期から降順で並んでいる前提
  const sorted = [...cycles].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime(),
  );

  // 平均周期長を計算（最大5サイクル分）
  let totalCycleLength = 0;
  let cycleLengthCount = 0;
  for (let i = 0; i < Math.min(sorted.length - 1, 5); i++) {
    const length = diffDays(sorted[i + 1].startDate, sorted[i].startDate);
    if (length >= 20 && length <= 45) {
      totalCycleLength += length;
      cycleLengthCount++;
    }
  }
  const avgCycleLength =
    cycleLengthCount > 0
      ? Math.round(totalCycleLength / cycleLengthCount)
      : DEFAULT_CYCLE_LENGTH;

  // 平均経血日数を計算
  const periodsWithEnd = sorted.filter((c) => c.endDate !== null);
  let totalPeriodLength = 0;
  for (const cycle of periodsWithEnd.slice(0, 5)) {
    const length = diffDays(cycle.startDate, cycle.endDate!);
    if (length >= 2 && length <= 10) {
      totalPeriodLength += length;
    }
  }
  const avgPeriodLength =
    periodsWithEnd.length > 0
      ? Math.round(totalPeriodLength / periodsWithEnd.length)
      : DEFAULT_PERIOD_LENGTH;

  const lastStart = sorted[0].startDate;
  const nextPeriodStart = addDays(lastStart, avgCycleLength);
  const nextPeriodEnd = addDays(nextPeriodStart, avgPeriodLength);
  const pmsStart = addDays(nextPeriodStart, -7);
  const pmsPeak = addDays(nextPeriodStart, -3);
  const goldenStart = addDays(nextPeriodEnd, 1);
  // 黄金期終了 = 排卵予定2日前（周期後半14日前 - 2日）
  const goldenEnd = addDays(nextPeriodStart, avgCycleLength - 16);

  return {
    avgCycleLength,
    avgPeriodLength,
    nextPeriodStart,
    nextPeriodEnd,
    pmsStart,
    pmsPeak,
    goldenStart,
    goldenEnd,
  };
}

export function getTodayPhase(
  today: Date,
  prediction: CyclePrediction,
  cycles: CycleRecord[],
): CyclePhase | null {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);

  const sorted = [...cycles].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime(),
  );
  const latestCycle = sorted[0];

  // 生理中かどうかを判定（最新周期に end_date がない or 今日が end_date 以前）
  const periodActive =
    latestCycle &&
    latestCycle.startDate <= t &&
    (latestCycle.endDate === null || latestCycle.endDate >= t);

  if (periodActive) {
    const day = diffDays(latestCycle.startDate, t) + 1;
    return { type: "period_active", dayOfPhase: day, prediction };
  }

  // 生理明け当日
  if (latestCycle?.endDate && isSameDay(addDays(latestCycle.endDate, 1), t)) {
    return { type: "period_end", dayOfPhase: 1, prediction };
  }

  // 黄金期（生理終了翌日〜goldenEnd）
  if (t >= prediction.goldenStart && t <= prediction.goldenEnd) {
    const day = diffDays(prediction.goldenStart, t) + 1;
    return { type: "golden", dayOfPhase: day, prediction };
  }

  // PMSピーク（生理3日前）
  if (isSameDay(t, prediction.pmsPeak)) {
    return { type: "pms_peak", dayOfPhase: 1, prediction };
  }

  // PMS開始（生理7日前〜）
  if (t >= prediction.pmsStart && t < prediction.pmsPeak) {
    const day = diffDays(prediction.pmsStart, t) + 1;
    return { type: "pms_start", dayOfPhase: day, prediction };
  }

  // 生理予測日当日（確認メッセージを送る）
  if (isSameDay(t, prediction.nextPeriodStart)) {
    return { type: "period_check", dayOfPhase: 1, prediction };
  }

  // 予測日を過ぎている（最大7日まで継続確認）
  const daysOverdue = diffDays(prediction.nextPeriodStart, t);
  if (daysOverdue > 0 && daysOverdue <= 7) {
    return { type: "period_overdue", dayOfPhase: daysOverdue, prediction };
  }

  return null;
}

export function formatDateJP(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function parseDateInput(input: string): Date | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (input === "今日" || input === "きょう") return today;
  if (input === "昨日" || input === "きのう") return addDays(today, -1);

  // M/D または MM/DD または YYYY/MM/DD
  const patterns = [
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,
    /^(\d{1,2})[\/\-](\d{1,2})$/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      if (match.length === 4) {
        const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        d.setHours(0, 0, 0, 0);
        return isNaN(d.getTime()) ? null : d;
      } else {
        const d = new Date(today.getFullYear(), Number(match[1]) - 1, Number(match[2]));
        d.setHours(0, 0, 0, 0);
        // 未来日付の場合は去年にする（例: 12月に3月と言ったら去年）
        if (d > today) d.setFullYear(d.getFullYear() - 1);
        return isNaN(d.getTime()) ? null : d;
      }
    }
  }

  return null;
}

/**
 * "3/12〜3/18" / "3/12-3/18" / "3月12日から3月18日" などから開始日・終了日を返す。
 * パース失敗時は null。
 */
export function parseDateRange(
  input: string,
): { start: Date; end: Date } | null {
  // セパレータ候補: 〜 ～ ~ - から
  const sep = /[〜～~]|から|-(?=\d)/;
  const parts = input.split(sep).map((s) => s.trim());
  if (parts.length !== 2) return null;

  // 日本語の「月」「日」を除去して parseDateInput に渡す
  const clean = (s: string) =>
    s.replace(/月/g, "/").replace(/日/g, "").replace(/\s/g, "");

  const start = parseDateInput(clean(parts[0]));
  const end = parseDateInput(clean(parts[1]));
  if (!start || !end) return null;
  if (end < start) return null;
  return { start, end };
}

export function getCyclePhaseDescription(phase: CyclePhase): string {
  const p = phase.prediction;
  switch (phase.type) {
    case "pms_start":
      return `PMS期間中（生理まであと約${diffDays(new Date(), p.nextPeriodStart)}日）`;
    case "pms_peak":
      return `PMSピーク期（生理まであと3日ごろ）`;
    case "period_check":
    case "period_overdue":
      return `生理予測日ごろ（次の生理予測: ${formatDateJP(p.nextPeriodStart)}）`;
    case "period_active":
      return `生理中（${phase.dayOfPhase}日目）`;
    case "period_end":
      return `生理明け（本日生理終了）`;
    case "golden":
      return `ダイエット黄金期（${phase.dayOfPhase}日目）体が動かしやすく脂肪燃焼しやすい時期`;
    case "normal":
      return `通常期（次の生理予測: ${formatDateJP(p.nextPeriodStart)}）`;
  }
}
