import type { CueLineDiff } from "./diffTypes";
import { charDiff, type CharSegment } from "./textLcs";

type Op =
  | { type: "equal"; a: string; b: string; lineNo: number }
  | { type: "delete"; a: string }
  | { type: "insert"; b: string };

const equalSegments = (text: string): CharSegment[] =>
  text ? [{ text, op: "equal" }] : [];

/**
 * 按行对齐两段字幕文本（行级 LCS），再对每对删除/插入行做行内字符 diff，
 * 使改动位置可以精确定位到行、到字符。
 * lineNo 以旧文本行号为准；纯新增行沿用前一行号，方便在双行视图里对齐。
 */
export function diffLines(before: string, after: string): CueLineDiff[] {
  const a = before.split("\n"),
    b = after.split("\n");
  const n = a.length,
    m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const ops: Op[] = [];
  let i = n,
    j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", a: a[i - 1], b: b[j - 1], lineNo: i });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "delete", a: a[i - 1] });
      i--;
    } else {
      ops.push({ type: "insert", b: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "delete", a: a[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "insert", b: b[j - 1] });
    j--;
  }
  ops.reverse();

  const result: CueLineDiff[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === "equal") {
      result.push({
        lineNo: op.lineNo,
        kind: "equal",
        oldSegments: equalSegments(op.a),
        newSegments: equalSegments(op.b),
      });
    } else if (op.type === "delete") {
      const next = ops[k + 1];
      if (next && next.type === "insert") {
        const segments = charDiff(op.a, next.b);
        result.push({
          lineNo: k + 1,
          kind: "deleted",
          oldSegments: segments.filter((s) => s.op !== "insert"),
        });
        result.push({
          lineNo: k + 1,
          kind: "inserted",
          newSegments: segments.filter((s) => s.op !== "delete"),
        });
        k++;
      } else {
        result.push({
          lineNo: k + 1,
          kind: "deleted",
          oldSegments: [{ text: op.a, op: "delete" }],
        });
      }
    } else {
      result.push({
        lineNo: k + 1,
        kind: "inserted",
        newSegments: [{ text: op.b, op: "insert" }],
      });
    }
  }
  return result;
}
