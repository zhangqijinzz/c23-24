import { formatTimestamp } from "../parsers/timecode";
import type { SubtitleCue } from "../models";

/**
 * 条目配对规则（保守策略，宁可不配对，也不能错配）：
 * 1. 只做「保序的一对一」配对：旧条目与新条目都按开始时间排序，
 *    用动态规划做对齐，禁止交叉配对。
 * 2. 时间闸门：两条目开始、结束的绝对差值都必须 <= TIME_PAIR_GATE_MS，
 *    时间被大幅调整的条目不允许配对（即使文本相同）。
 * 3. 文本闸门：去除全部空白后按字符计算 LCS 相似度，必须 >= TEXT_PAIR_SIMILARITY，
 *    文本几乎完全换掉的条目不允许配对（即使时间接近）。
 * 4. 在以上约束内，选择文本相似度总和最大的对齐方式。
 * 5. 无法配对的旧条目记为「删除」，无法配对的新条目记为「新增」。
 * 不依赖 cue.id：快照恢复会重建 id，配对只看时间与文本。
 */
export const TIME_PAIR_GATE_MS = 3000;
export const TEXT_PAIR_SIMILARITY = 0.6;
export const TIME_DRIFT_NOTE_MS = 20;

export type ChangeKind = "added" | "removed" | "text" | "time" | "both";
export type TextSegmentKind = "equal" | "added" | "removed";

export interface TextSegment {
  kind: TextSegmentKind;
  text: string;
}
export interface LineChange {
  /** 旧条目中的行号（1 起）；纯新增行为 null */
  oldLineNo: number | null;
  /** 新条目中的行号（1 起）；纯删除行为 null */
  newLineNo: number | null;
  kind: "equal" | "added" | "removed";
  /** 文本行，新增/删除行直接展示整行 */
  text: string;
  /** 文本改动行内的字符级分段；未改动时整行一个 equal 分段 */
  segments?: TextSegment[];
}
export interface TimeDelta {
  startDeltaMs: number;
  endDeltaMs: number;
}
export interface CueChange {
  /** 稳定 id，用于高亮与键盘导航 */
  id: string;
  kind: ChangeKind;
  oldCue: SubtitleCue | null;
  newCue: SubtitleCue | null;
  time: TimeDelta | null;
  lineChanges: LineChange[] | null;
}
export interface CuePair {
  oldCue: SubtitleCue | null;
  newCue: SubtitleCue | null;
}
export interface CueDiffResult {
  pairs: CuePair[];
  changes: CueChange[];
  oldCount: number;
  newCount: number;
}

/** 去空白后的字符序列（Array.from 正确处理多字节字符） */
export function normalizedChars(text: string): string[] {
  return Array.from(text.replace(/\s/g, ""));
}

/**
 * LCS 长度表（前缀式）：table[i][j] 为 left 前 i 项与 right 前 j 项的 LCS 长度。
 * 回溯时从右下角出发：相等走对角，否则走向数值更大的相邻格。
 */
function lcsLengths<T>(left: T[], right: T[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = 1; i <= left.length; i += 1)
    for (let j = 1; j <= right.length; j += 1)
      table[i][j] =
        left[i - 1] === right[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
  return table;
}

/** 去空白字符的 LCS 相似度，范围 0~1；两边都为空视为完全相同 */
export function textSimilarity(a: string, b: string): number {
  const left = normalizedChars(a),
    right = normalizedChars(b);
  if (!left.length && !right.length) return 1;
  const common = lcsLengths(left, right)[left.length][right.length];
  return (2 * common) / (left.length + right.length);
}

function withinTimeGate(a: SubtitleCue, b: SubtitleCue): boolean {
  return (
    Math.abs(a.startMs - b.startMs) <= TIME_PAIR_GATE_MS &&
    Math.abs(a.endMs - b.endMs) <= TIME_PAIR_GATE_MS
  );
}

/**
 * 保序一对一配对。
 * 候选先过时间闸门；DP 在候选中最大化文本相似度总和。
 */
function alignCues(oldCues: SubtitleCue[], newCues: SubtitleCue[]): CuePair[] {
  const eligible = (a: SubtitleCue, b: SubtitleCue) => {
    if (!withinTimeGate(a, b)) return false;
    return textSimilarity(a.text, b.text) >= TEXT_PAIR_SIMILARITY;
  };

  // score[i][j]：旧第 i 条与新第 j 条配对的相似度；undefined 表示不可配对
  const score: (number | undefined)[][] = oldCues.map((a) =>
    newCues.map((b) =>
      eligible(a, b) ? textSimilarity(a.text, b.text) : undefined,
    ),
  );
  // dp[i][j]：oldCues[i..] 与 newCues[j..] 的最优相似度总和
  const dp = Array.from({ length: oldCues.length + 1 }, () =>
    new Array<number>(newCues.length + 1).fill(0),
  );
  for (let i = oldCues.length - 1; i >= 0; i -= 1) {
    for (let j = newCues.length - 1; j >= 0; j -= 1) {
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      const s = score[i][j];
      if (s !== undefined) dp[i][j] = Math.max(dp[i][j], s + dp[i + 1][j + 1]);
    }
  }

  const pairs: CuePair[] = [];
  let i = 0,
    j = 0;
  while (i < oldCues.length && j < newCues.length) {
    const s = score[i][j];
    if (s !== undefined && Math.abs(s + dp[i + 1][j + 1] - dp[i][j]) < 1e-9) {
      pairs.push({ oldCue: oldCues[i], newCue: newCues[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pairs.push({ oldCue: oldCues[i], newCue: null });
      i += 1;
    } else {
      pairs.push({ oldCue: null, newCue: newCues[j] });
      j += 1;
    }
  }
  while (i < oldCues.length) {
    pairs.push({ oldCue: oldCues[i], newCue: null });
    i += 1;
  }
  while (j < newCues.length) {
    pairs.push({ oldCue: null, newCue: newCues[j] });
    j += 1;
  }
  return pairs;
}

/** 单行内的字符级改动分段 */
export function diffLineSegments(
  oldLine: string,
  newLine: string,
): TextSegment[] {
  const left = Array.from(oldLine),
    right = Array.from(newLine);
  const table = lcsLengths(left, right);
  // 自右下角回溯，再反转得到阅读顺序
  type Trace =
    | { type: "equal"; value: string }
    | { type: "removed"; value: string }
    | { type: "added"; value: string };
  const trace: Trace[] = [];
  let i = left.length,
    j = right.length;
  while (i > 0 && j > 0) {
    if (left[i - 1] === right[j - 1]) {
      trace.push({ type: "equal", value: left[i - 1] });
      i -= 1;
      j -= 1;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      trace.push({ type: "removed", value: left[i - 1] });
      i -= 1;
    } else {
      trace.push({ type: "added", value: right[j - 1] });
      j -= 1;
    }
  }
  while (i > 0) {
    trace.push({ type: "removed", value: left[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    trace.push({ type: "added", value: right[j - 1] });
    j -= 1;
  }
  trace.reverse();

  const segments: TextSegment[] = [];
  const push = (kind: TextSegmentKind, text: string) => {
    if (!text) return;
    if (segments.at(-1)?.kind === kind)
      segments[segments.length - 1] = {
        kind,
        text: segments[segments.length - 1].text + text,
      };
    else segments.push({ kind, text });
  };
  trace.forEach((item) => push(item.type, item.value));
  return segments;
}

/** 条目文本的行级 diff：先按行 LCS 对齐，再对成对的改动行做字符级 diff */
export function diffTextLines(oldText: string, newText: string): LineChange[] {
  const oldLines = oldText.split("\n"),
    newLines = newText.split("\n");
  const table = lcsLengths(oldLines, newLines);
  // 从右下角回溯得到 旧行索引/新行索引 的配对序列（阅读顺序）
  type Trace =
    | { type: "match"; i: number; j: number }
    | { type: "del"; i: number }
    | { type: "add"; j: number };
  const reversed: Trace[] = [];
  let i = oldLines.length,
    j = newLines.length;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: "match", i: i - 1, j: j - 1 });
      i -= 1;
      j -= 1;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      reversed.push({ type: "del", i: i - 1 });
      i -= 1;
    } else {
      reversed.push({ type: "add", j: j - 1 });
      j -= 1;
    }
  }
  while (i > 0) {
    reversed.push({ type: "del", i: i - 1 });
    i -= 1;
  }
  while (j > 0) {
    reversed.push({ type: "add", j: j - 1 });
    j -= 1;
  }
  const trace = reversed.reverse();

  const result: LineChange[] = [];
  // 相邻的 删除+新增 或 新增+删除 视为同一行被替换，合并展示并做行内字符 diff；
  // 其余按纯删除 / 纯新增 / 未改动处理。
  for (let k = 0; k < trace.length; k += 1) {
    const current = trace[k],
      next = trace[k + 1];
    if (
      (current.type === "del" && next?.type === "add") ||
      (current.type === "add" && next?.type === "del")
    ) {
      const del =
        current.type === "del"
          ? { i: current.i }
          : { i: (next as { type: "del"; i: number }).i };
      const add =
        current.type === "add"
          ? { j: current.j }
          : { j: (next as { type: "add"; j: number }).j };
      result.push({
        oldLineNo: del.i + 1,
        newLineNo: add.j + 1,
        kind: "equal",
        text: "",
        segments: diffLineSegments(oldLines[del.i], newLines[add.j]),
      });
      k += 1;
    } else if (current.type === "del") {
      result.push({
        oldLineNo: current.i + 1,
        newLineNo: null,
        kind: "removed",
        text: oldLines[current.i],
      });
    } else if (current.type === "add") {
      result.push({
        oldLineNo: null,
        newLineNo: current.j + 1,
        kind: "added",
        text: newLines[current.j],
      });
    } else {
      result.push({
        oldLineNo: current.i + 1,
        newLineNo: current.j + 1,
        kind: "equal",
        text: oldLines[current.i],
      });
    }
  }
  return result;
}

function changedLines(lines: LineChange[]): boolean {
  return lines.some((line) => line.kind !== "equal" || line.segments);
}

/** 比较两份条目列表，得到配对关系与按时间排序的变更清单 */
export function diffCueSets(
  oldCues: SubtitleCue[],
  newCues: SubtitleCue[],
): CueDiffResult {
  const orderedOld = [...oldCues].sort((a, b) => a.startMs - b.startMs);
  const orderedNew = [...newCues].sort((a, b) => a.startMs - b.startMs);
  const pairs = alignCues(orderedOld, orderedNew);

  const changes: CueChange[] = [];
  pairs.forEach((pair, index) => {
    const { oldCue, newCue } = pair;
    if (oldCue && !newCue) {
      changes.push({
        id: `change-${index}`,
        kind: "removed",
        oldCue,
        newCue: null,
        time: null,
        lineChanges: null,
      });
      return;
    }
    if (!oldCue && newCue) {
      changes.push({
        id: `change-${index}`,
        kind: "added",
        oldCue: null,
        newCue,
        time: null,
        lineChanges: null,
      });
      return;
    }
    if (!oldCue || !newCue) return;
    const startDeltaMs = newCue.startMs - oldCue.startMs,
      endDeltaMs = newCue.endMs - oldCue.endMs;
    const timeChanged =
      Math.abs(startDeltaMs) > TIME_DRIFT_NOTE_MS ||
      Math.abs(endDeltaMs) > TIME_DRIFT_NOTE_MS;
    const lineChanges = diffTextLines(oldCue.text, newCue.text);
    const textChanged = changedLines(lineChanges);
    if (!timeChanged && !textChanged) return;
    const kind: ChangeKind =
      timeChanged && textChanged ? "both" : timeChanged ? "time" : "text";
    changes.push({
      id: `change-${index}`,
      kind,
      oldCue,
      newCue,
      time: timeChanged ? { startDeltaMs, endDeltaMs } : null,
      lineChanges: textChanged ? lineChanges : null,
    });
  });

  changes.sort(
    (a, b) => (a.newCue ?? a.oldCue)!.startMs - (b.newCue ?? b.oldCue)!.startMs,
  );
  return {
    pairs,
    changes,
    oldCount: orderedOld.length,
    newCount: orderedNew.length,
  };
}

/** +1.20s / -400ms 形式的漂移值 */
export function formatDelta(ms: number): string {
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : "",
    abs = Math.abs(ms);
  return abs >= 1000 ? `${sign}${(abs / 1000).toFixed(2)}s` : `${sign}${abs}ms`;
}

export function formatCueTime(cue: SubtitleCue): string {
  return `${formatTimestamp(cue.startMs, "srt")} → ${formatTimestamp(cue.endMs, "srt")}`;
}
