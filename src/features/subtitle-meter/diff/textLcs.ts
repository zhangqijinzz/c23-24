/**
 * 最长公共子序列工具：同时用于
 * - 计算两个字幕条目的文本相似度（配对规则）
 * - 对改动文本做行级对齐与行内字符标红（展示改动位置）
 */

/** 归一化：去除全部空白并小写，避免标点空格、换行差异干扰配对判断 */
export function normalizeText(text: string): string {
  return text.replace(/\s/g, "").toLocaleLowerCase();
}

export function lcsLength(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let next = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      next[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], next[j - 1]);
    }
    [prev, next] = [next, prev];
  }
  return prev[b.length];
}

/**
 * 文本相似度 = 公共字符数 / 较长文本长度，范围 0~1。
 * 两边都为空时视为完全相同（1）。
 */
export function textSimilarity(a: string, b: string): number {
  const left = normalizeText(a),
    right = normalizeText(b);
  if (!left.length && !right.length) return 1;
  const longest = Math.max(left.length, right.length);
  if (!longest) return 1;
  return lcsLength(left, right) / longest;
}

export type CharOp = "equal" | "delete" | "insert";
export interface CharSegment {
  text: string;
  op: CharOp;
}

/** 完整回溯版 LCS，输出字符级的 相同/删除(旧)/插入(新) 片段序列 */
export function charDiff(a: string, b: string): CharSegment[] {
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
  const segments: CharSegment[] = [];
  let i = n,
    j = m;
  const push = (text: string, op: CharOp) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.op === op) last.text += text;
    else segments.push({ text, op });
  };
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      push(a[i - 1], "equal");
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      push(a[i - 1], "delete");
      i--;
    } else {
      push(b[j - 1], "insert");
      j--;
    }
  }
  while (i > 0) {
    push(a[i - 1], "delete");
    i--;
  }
  while (j > 0) {
    push(b[j - 1], "insert");
    j--;
  }
  return segments.reverse();
}

/** 旧行片段：公共字符 + 被删除字符 */
export function oldLineSegments(a: string, b: string): CharSegment[] {
  return charDiff(a, b).filter((s) => s.op !== "insert");
}

/** 新行片段：公共字符 + 新插入字符 */
export function newLineSegments(a: string, b: string): CharSegment[] {
  return charDiff(a, b).filter((s) => s.op !== "delete");
}
