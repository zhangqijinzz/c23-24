import type { CueDiff, DiffSide, VersionDiff } from "./diffTypes";
import { diffLines } from "./lineDiff";
import { textSimilarity } from "./textLcs";

/**
 * 条目配对规则（compareVersions 只展示、不修改任何一侧内容）
 *
 * 两侧条目先按 id 建立候选，id 代表「同一条目」，但不是充分条件：
 * 1. id 相同即配对；但若文本相似度 < SAME_ID_TEXT_FLOOR 且
 *    开始时间漂移 > SAME_ID_TIME_LIMIT_MS，视为「条目被删掉又另写了一条」，
 *    拆成 删除 + 新增，不允许错配。
 * 2. id 对不上的条目做全局两两评分，按分数降序贪心取「互为最优」的一对一配对，
 *    且必须跨过对应门槛之一：
 *    a. 文本高度相似（≥ TEXT_MATCH_MIN）——允许时间任意漂移；
 *    b. 时间几乎未动（≤ NEAR_TIME_LIMIT_MS）且文本有一定相似（≥ NEAR_TEXT_MIN）
 *       ——覆盖大段改写但同位置的微调。
 * 3. 其余条目：仅存在于旧侧 → 删除；仅存在于新侧 → 新增。
 *
 * 因此「时间被大幅调整 + 文本几乎完全换掉」的两个条目既过不了规则 1，
 * 也过不了规则 2，绝不会被错配成同一条。
 */
export const SAME_ID_TEXT_FLOOR = 0.3;
export const SAME_ID_TIME_LIMIT_MS = 3000;
export const TEXT_MATCH_MIN = 0.6;
export const NEAR_TEXT_MIN = 0.45;
export const NEAR_TIME_LIMIT_MS = 1500;

interface PairCandidate {
  ai: number;
  bi: number;
  similarity: number;
  startGap: number;
  score: number;
}

function pairCues(sideA: DiffSide, sideB: DiffSide) {
  const byIdA = new Map<string, number>();
  sideA.cues.forEach((cue, index) => byIdA.set(cue.id, index));
  const byIdB = new Map<string, number>();
  sideB.cues.forEach((cue, index) => byIdB.set(cue.id, index));

  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  const pairs: Array<{ ai: number; bi: number; similarity: number }> = [];

  // 规则 1：同 id 配对（带防错配闸门）
  for (const [id, ai] of byIdA) {
    const bi = byIdB.get(id);
    if (bi === undefined) continue;
    const cueA = sideA.cues[ai],
      cueB = sideB.cues[bi];
    const similarity = textSimilarity(cueA.text, cueB.text),
      startGap = Math.abs(cueB.startMs - cueA.startMs);
    if (similarity < SAME_ID_TEXT_FLOOR && startGap > SAME_ID_TIME_LIMIT_MS)
      continue;
    matchedA.add(ai);
    matchedB.add(bi);
    pairs.push({ ai, bi, similarity });
  }

  // 规则 2：跨 id 的全局两两评分，取互为最优且过门槛的一对一配对
  const candidates: PairCandidate[] = [];
  sideA.cues.forEach((cueA, ai) => {
    if (matchedA.has(ai)) return;
    sideB.cues.forEach((cueB, bi) => {
      if (matchedB.has(bi)) return;
      const similarity = textSimilarity(cueA.text, cueB.text),
        startGap = Math.abs(cueB.startMs - cueA.startMs);
      const textPass = similarity >= TEXT_MATCH_MIN,
        nearPass =
          startGap <= NEAR_TIME_LIMIT_MS && similarity >= NEAR_TEXT_MIN;
      if (!textPass && !nearPass) return;
      // 文本相似为主、时间接近为辅；同 id 理论上已在规则 1 处理
      candidates.push({
        ai,
        bi,
        similarity,
        startGap,
        score: similarity * 1000 - startGap / 1000,
      });
    });
  });
  candidates
    .sort((x, y) => y.score - x.score || x.ai - y.ai || x.bi - y.bi)
    .forEach(({ ai, bi, similarity }) => {
      if (matchedA.has(ai) || matchedB.has(bi)) return;
      matchedA.add(ai);
      matchedB.add(bi);
      pairs.push({ ai, bi, similarity });
    });

  return { pairs, matchedA, matchedB };
}

export function compareVersions(sideA: DiffSide, sideB: DiffSide): VersionDiff {
  const { pairs, matchedA, matchedB } = pairCues(sideA, sideB);
  const entries: CueDiff[] = [];

  for (const { ai, bi } of pairs) {
    const cueA = sideA.cues[ai],
      cueB = sideB.cues[bi];
    const startDeltaMs = cueB.startMs - cueA.startMs,
      endDeltaMs = cueB.endMs - cueA.endMs;
    const textChanged = cueA.text !== cueB.text,
      timeChanged = startDeltaMs !== 0 || endDeltaMs !== 0;
    const kind =
      textChanged && timeChanged
        ? "both"
        : textChanged
          ? "text"
          : timeChanged
            ? "time"
            : "same";
    entries.push({
      key: `pair-${cueA.id}-${cueB.id}`,
      kind,
      cueA,
      cueB,
      indexA: cueA.index,
      indexB: cueB.index,
      startDeltaMs,
      endDeltaMs,
      lines: textChanged ? diffLines(cueA.text, cueB.text) : [],
    });
  }

  // 规则 3：未配对条目分别记为删除 / 新增
  sideA.cues.forEach((cueA, ai) => {
    if (matchedA.has(ai)) return;
    entries.push({
      key: `deleted-${cueA.id}`,
      kind: "deleted",
      cueA,
      cueB: null,
      indexA: cueA.index,
      indexB: null,
      startDeltaMs: 0,
      endDeltaMs: 0,
      lines: [],
    });
  });
  sideB.cues.forEach((cueB, bi) => {
    if (matchedB.has(bi)) return;
    entries.push({
      key: `added-${cueB.id}`,
      kind: "added",
      cueA: null,
      cueB: cueB,
      indexA: null,
      indexB: cueB.index,
      startDeltaMs: 0,
      endDeltaMs: 0,
      lines: [],
    });
  });

  // 时间轴排序：旧侧时间优先，新增条目用新侧时间插入；并列时删除排在新增前
  entries.sort((x, y) => {
    const tx = x.cueA?.startMs ?? x.cueB?.startMs ?? 0,
      ty = y.cueA?.startMs ?? y.cueB?.startMs ?? 0;
    if (tx !== ty) return tx - ty;
    if (x.kind === "deleted" && y.kind === "added") return -1;
    if (x.kind === "added" && y.kind === "deleted") return 1;
    return x.key.localeCompare(y.key);
  });

  // 未发生变化的配对条目不进入差异列表，只统计数量
  const changed = entries.filter((entry) => entry.kind !== "same");
  const stats = {
    added: 0,
    deleted: 0,
    text: 0,
    time: 0,
    same: 0,
  };
  entries.forEach((entry) => {
    if (entry.kind === "added") stats.added++;
    else if (entry.kind === "deleted") stats.deleted++;
    else if (entry.kind === "text") stats.text++;
    else if (entry.kind === "time") stats.time++;
    else if (entry.kind === "both") {
      stats.text++;
      stats.time++;
    } else stats.same++;
  });

  return { entries: changed, stats, total: entries.length };
}
