import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "../models";
import {
  compareVersions,
  NEAR_TEXT_MIN,
  TEXT_MATCH_MIN,
} from "../diff/cueDiff";
import type { DiffSide } from "../diff/diffTypes";
import { formatSignedDelta } from "../diff/diffFormat";

const cue = (
  id: string,
  index: number,
  startMs: number,
  endMs: number,
  text: string,
): SubtitleCue => ({ id, index, startMs, endMs, text });

const sides = (cuesA: SubtitleCue[], cuesB: SubtitleCue[]) => ({
  sideA: { id: "a", label: "旧快照", cues: cuesA } satisfies DiffSide,
  sideB: { id: "b", label: "当前", cues: cuesB } satisfies DiffSide,
});

describe("compareVersions", () => {
  it("reports nothing when both sides are identical", () => {
    const { sideA, sideB } = sides(
      [cue("cue-1", 1, 0, 1000, "你好世界")],
      [cue("cue-1", 1, 0, 1000, "你好世界")],
    );
    const diff = compareVersions(sideA, sideB);
    expect(diff.entries).toHaveLength(0);
    expect(diff.stats.same).toBe(1);
  });

  it("lists unmatched cues as added and deleted", () => {
    const { sideA, sideB } = sides(
      [
        cue("cue-1", 1, 0, 1000, "旧的第一条"),
        cue("cue-2", 2, 2000, 3000, "将被删除"),
      ],
      [
        cue("cue-1", 1, 0, 1000, "旧的第一条"),
        cue("cue-3", 3, 4000, 5000, "全新的一条"),
      ],
    );
    const diff = compareVersions(sideA, sideB);
    expect(diff.stats.deleted).toBe(1);
    expect(diff.stats.added).toBe(1);
    const deleted = diff.entries.find((e) => e.kind === "deleted");
    const added = diff.entries.find((e) => e.kind === "added");
    expect(deleted?.cueA?.text).toBe("将被删除");
    expect(added?.cueB?.text).toBe("全新的一条");
  });

  it("pairs same-id cues with text edits and emits line-level positions", () => {
    const { sideA, sideB } = sides(
      [cue("cue-1", 1, 0, 2000, "第一行原文\n第二行不变")],
      [cue("cue-1", 1, 0, 2000, "第一行改后\n第二行不变")],
    );
    const diff = compareVersions(sideA, sideB);
    expect(diff.entries).toHaveLength(1);
    const entry = diff.entries[0];
    expect(entry.kind).toBe("text");
    expect(entry.lines.some((line) => line.kind === "deleted")).toBe(true);
    expect(entry.lines.some((line) => line.kind === "inserted")).toBe(true);
    const deletedLine = entry.lines.find((line) => line.kind === "deleted");
    const changedSegments = deletedLine?.oldSegments?.filter(
      (s) => s.op === "delete",
    );
    expect(changedSegments?.map((s) => s.text).join("")).toContain("原文");
  });

  it("pairs time drift even when times move far, and gives concrete deltas", () => {
    const { sideA, sideB } = sides(
      [cue("cue-1", 1, 1000, 3000, "只移动时间的同一条")],
      [cue("cue-1", 1, 2500, 4200, "只移动时间的同一条")],
    );
    const diff = compareVersions(sideA, sideB);
    expect(diff.entries[0].kind).toBe("time");
    expect(diff.entries[0].startDeltaMs).toBe(1500);
    expect(diff.entries[0].endDeltaMs).toBe(1200);
    expect(formatSignedDelta(1500)).toBe("+1.500s");
    expect(formatSignedDelta(-40)).toBe("−0.040s");
  });

  it("still pairs same-id cues whose text is mostly rewritten but time barely moves", () => {
    const { sideA, sideB } = sides(
      [cue("cue-9", 9, 5000, 7000, "这句字幕稍后会被改写得面目全非")],
      [cue("cue-9", 9, 5050, 7000, "完全不同的另一句全新中文内容呀")],
    );
    const diff = compareVersions(sideA, sideB);
    expect(
      diff.entries[0].kind === "text" || diff.entries[0].kind === "both",
    ).toBe(true);
    expect(diff.entries[0].cueA?.id).toBe("cue-9");
    expect(diff.entries[0].cueB?.id).toBe("cue-9");
  });

  it("does not mispair a cue that is fully rewritten AND moved far away", () => {
    const { sideA, sideB } = sides(
      [cue("cue-1", 1, 1000, 3000, "这是开头处的第一句完全独立的台词内容")],
      [cue("cue-1", 1, 60000, 62000, "一分钟后出现的是另外一句毫不相干的话语")],
    );
    const diff = compareVersions(sideA, sideB);
    const kinds = diff.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(["added", "deleted"]);
    expect(diff.entries.some((e) => e.cueA && e.cueB)).toBe(false);
  });

  it("pairs different-id cues by text similarity across a rename", () => {
    const { sideA, sideB } = sides(
      [cue("cue-2", 2, 2000, 4000, "中间插入字幕之后，我的编号变了")],
      [cue("cue-3", 3, 2000, 4000, "中间插入字幕之后，我的编号改变了")],
    );
    const diff = compareVersions(sideA, sideB);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0].cueA?.id).toBe("cue-2");
    expect(diff.entries[0].cueB?.id).toBe("cue-3");
    expect(diff.entries[0].kind).toBe("text");
  });

  it("rejects cross-id pairing when both text similarity and time proximity fail", () => {
    expect(TEXT_MATCH_MIN).toBeGreaterThan(NEAR_TEXT_MIN);
    const { sideA, sideB } = sides(
      [cue("cue-1", 1, 1000, 3000, "清晨的阳光照进安静的房间里面")],
      [cue("cue-2", 2, 9000, 11000, "深夜里列车缓缓驶过空旷的站台")],
    );
    const diff = compareVersions(sideA, sideB);
    expect(diff.entries.map((e) => e.kind).sort()).toEqual([
      "added",
      "deleted",
    ]);
  });

  it("counts both text and time for a cue carrying both changes", () => {
    const { sideA, sideB } = sides(
      [cue("cue-1", 1, 0, 2000, "原文文本")],
      [cue("cue-1", 1, 800, 2600, "改后文本内容")],
    );
    const diff = compareVersions(sideA, sideB);
    expect(diff.entries[0].kind).toBe("both");
    expect(diff.stats.text).toBe(1);
    expect(diff.stats.time).toBe(1);
  });
});
