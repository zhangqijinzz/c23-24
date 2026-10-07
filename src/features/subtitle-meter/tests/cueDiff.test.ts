import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "../models";
import {
  diffCueSets,
  diffLineSegments,
  diffTextLines,
  formatDelta,
  TEXT_PAIR_SIMILARITY,
  TIME_PAIR_GATE_MS,
  textSimilarity,
} from "../comparison/cueDiff";

function cue(
  index: number,
  startMs: number,
  endMs: number,
  text: string,
  id = `cue-${index}`,
): SubtitleCue {
  return { id, index, startMs, endMs, text };
}

const kinds = (result: ReturnType<typeof diffCueSets>) =>
  result.changes.map((change) => change.kind);

describe("cue pairing", () => {
  it("pairs identical cues and reports no changes", () => {
    const cues = [cue(1, 1000, 3000, "你好世界"), cue(2, 4000, 6000, "再见")];
    const result = diffCueSets(
      cues,
      cues.map((item) => ({ ...item })),
    );
    expect(result.changes).toHaveLength(0);
    expect(result.pairs).toHaveLength(2);
  });

  it("does not rely on cue ids when matching the same entry", () => {
    const oldCues = [cue(1, 1000, 3000, "稳定文本")];
    const newCues = [cue(1, 1000, 3000, "稳定文本", "a-totally-new-id")];
    const result = diffCueSets(oldCues, newCues);
    expect(result.changes).toHaveLength(0);
    expect(result.pairs[0]).toEqual({
      oldCue: oldCues[0],
      newCue: newCues[0],
    });
  });

  it("refuses to pair entries whose time moved beyond the gate even with equal text", () => {
    const oldCues = [cue(1, 1000, 2000, "完全相同的一句话")];
    const newCues = [
      cue(1, 1000 + TIME_PAIR_GATE_MS + 500, 2500, "完全相同的一句话"),
    ];
    const result = diffCueSets(oldCues, newCues);
    expect(kinds(result).sort()).toEqual(["added", "removed"]);
    expect(result.changes[0].time).toBeNull();
  });

  it("refuses to pair entries whose text was almost fully rewritten even at the same time", () => {
    const oldCues = [cue(1, 1000, 3000, "第一版本的字幕内容写的是甲")];
    const newCues = [cue(1, 1000, 3000, "完全替换成另外一句毫不相干的乙")];
    expect(textSimilarity(oldCues[0].text, newCues[0].text)).toBeLessThan(
      TEXT_PAIR_SIMILARITY,
    );
    const result = diffCueSets(oldCues, newCues);
    expect(kinds(result).sort()).toEqual(["added", "removed"]);
  });

  it("keeps pairing one-to-one and order preserving for a mixed edit", () => {
    const oldCues = [
      cue(1, 0, 1000, "第一句"),
      cue(2, 2000, 3000, "第二句"),
      cue(3, 4000, 5000, "第三句"),
    ];
    const newCues = [
      cue(1, 0, 1000, "第一句"),
      cue(3, 4200, 5200, "第三句修改"),
      cue(4, 7000, 8000, "新增的一句"),
    ];
    const result = diffCueSets(oldCues, newCues);
    // 第二句被删除、第三句时间+文本改动、新句新增
    expect(kinds(result)).toEqual(["removed", "both", "added"]);
    const removed = result.changes.find((c) => c.kind === "removed")!;
    expect(removed.oldCue?.text).toBe("第二句");
    const changed = result.changes.find((c) => c.kind === "both")!;
    expect(changed.time).toEqual({ startDeltaMs: 200, endDeltaMs: 200 });
    expect(changed.oldCue?.text).toBe("第三句");
    expect(changed.newCue?.text).toBe("第三句修改");
  });

  it("classifies time-only and text-only changes separately", () => {
    const result = diffCueSets(
      [cue(1, 0, 1000, "只改时间"), cue(2, 2000, 3000, "只改文本")],
      [cue(1, 300, 1300, "只改时间"), cue(2, 2000, 3000, "只改文本啦")],
    );
    expect(kinds(result).sort()).toEqual(["text", "time"]);
  });

  it("ignores drift at or below the reporting threshold", () => {
    const result = diffCueSets(
      [cue(1, 1000, 3000, "稳")],
      [cue(1, 1010, 2990, "稳")],
    );
    expect(result.changes).toHaveLength(0);
  });
});

describe("time delta values", () => {
  it("exposes concrete start/end deltas", () => {
    const result = diffCueSets(
      [cue(1, 5000, 7000, "漂移")],
      [cue(1, 6200, 6900, "漂移")],
    );
    expect(result.changes[0].time).toEqual({
      startDeltaMs: 1200,
      endDeltaMs: -100,
    });
  });

  it("formats signed seconds and milliseconds", () => {
    expect(formatDelta(1200)).toBe("+1.20s");
    expect(formatDelta(-400)).toBe("−400ms");
    expect(formatDelta(0)).toBe("0ms");
  });
});

describe("text diff", () => {
  it("marks changed characters on the affected line with old and new line numbers", () => {
    const lines = diffTextLines("第一行原文", "第一行改文");
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.oldLineNo).toBe(1);
    expect(line.newLineNo).toBe(1);
    expect(line.segments).toBeDefined();
    const joined = (kind: string) =>
      line
        .segments!.filter((s) => s.kind === kind)
        .map((s) => s.text)
        .join("");
    expect(joined("removed")).toBe("原");
    expect(joined("added")).toBe("改");
    expect(joined("equal")).toContain("第一行");
  });

  it("keeps unchanged lines visible and assigns side-specific line numbers", () => {
    const lines = diffTextLines("保留行\n旧的第二行", "保留行\n新的第二行");
    const equalLine = lines.find((l) => l.kind === "equal" && !l.segments);
    expect(equalLine?.oldLineNo).toBe(1);
    expect(equalLine?.newLineNo).toBe(1);
    expect(equalLine?.text).toBe("保留行");
  });

  it("reports pure added and removed lines with null on the missing side", () => {
    const lines = diffTextLines("A\nB", "A\nB\nC");
    const added = lines.find((l) => l.kind === "added");
    expect(added?.newLineNo).toBe(3);
    expect(added?.oldLineNo).toBeNull();

    const removed = diffTextLines("A\nB\nC", "A\nC").find(
      (l) => l.kind === "removed",
    );
    expect(removed?.oldLineNo).toBe(2);
    expect(removed?.newLineNo).toBeNull();
  });

  it("diffs inside single lines at character level", () => {
    const segments = diffLineSegments("abcdef", "abXef");
    const text = (kind: string) =>
      segments
        .filter((s) => s.kind === kind)
        .map((s) => s.text)
        .join("");
    expect(text("removed")).toBe("cd");
    expect(text("added")).toBe("X");
    expect(text("equal")).toBe("abef");
  });

  it("treats whitespace differences leniently in the pairing gate but shows them in the line diff", () => {
    expect(textSimilarity("你好 世界", "你好世界")).toBe(1);
    const lines = diffTextLines("你好 世界", "你好世界");
    expect(lines.some((l) => l.segments)).toBe(true);
  });
});

describe("result ordering", () => {
  it("orders changes by the time they occur", () => {
    const result = diffCueSets(
      [cue(2, 8000, 9000, "后面的"), cue(1, 0, 1000, "前面的")],
      [cue(1, 0, 1000, "前面的改了"), cue(2, 8000, 9000, "后面的也改")],
    );
    expect(result.changes[0].oldCue?.index).toBe(1);
  });
});
