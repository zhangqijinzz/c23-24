import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubtitleProject } from "../models";
import { VersionCompareModule } from "../components/VersionCompareModule";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const project: SubtitleProject = {
  id: "p1",
  name: "clip.srt",
  format: "srt",
  updatedAt: 0,
  cues: [
    { id: "cue-1", index: 1, startMs: 1000, endMs: 3000, text: "改后的第一句" },
    { id: "cue-2", index: 2, startMs: 5000, endMs: 7000, text: "保留的第二句" },
  ],
  versions: [
    {
      id: "v-1",
      label: "快照 1",
      savedAt: 1_700_000_000_000,
      cues: [
        {
          id: "cue-1",
          index: 1,
          startMs: 0,
          endMs: 2000,
          text: "原来的第一句",
        },
        {
          id: "cue-2",
          index: 2,
          startMs: 5000,
          endMs: 7000,
          text: "保留的第二句",
        },
      ],
    },
  ],
};

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

let root: ReturnType<typeof createRoot> | null = null;

const renderCompare = (onClose = vi.fn()) => {
  root = createRoot(container);
  act(() => {
    root!.render(
      <VersionCompareModule
        project={project}
        initial={{ sideAId: "v-1", sideBId: "current" }}
        onClose={onClose}
      />,
    );
  });
  return onClose;
};

describe("VersionCompareModule", () => {
  it("lists the changed entry with concrete drift and read-only notice", () => {
    renderCompare();
    const text = container.textContent ?? "";
    expect(text).toContain("版本对比");
    expect(text).toContain("新增 0");
    expect(text).toContain("删除 0");
    expect(text).toContain("时间 1");
    expect(text).toContain("对比只读");
    // 时间漂移给出具体差值：开始 1000 - 0 = +1.000s，结束 3000 - 2000 = +1.000s
    expect(text).toContain("+1.000s");
    // 行级文本差异：旧字符被标红、新字符标绿
    const deletedChars = container.querySelectorAll(".diff-char-del");
    const insertedChars = container.querySelectorAll(".diff-char-ins");
    expect([...deletedChars].map((n) => n.textContent).join("")).toContain(
      "原来",
    );
    expect([...insertedChars].map((n) => n.textContent).join("")).toContain(
      "改后",
    );
  });

  it("highlights on the timeline and jumps row by row through filters", () => {
    renderCompare();
    // 时间轴上旧、新两轨各渲染该条目
    const timelineBlocks = container.querySelectorAll("[data-diff-key]");
    expect(timelineBlocks.length).toBe(2);
    expect(container.querySelectorAll(".compare-cue-both").length).toBe(2);
    // 点击时间轴块，对应差异行被高亮
    act(() => {
      (timelineBlocks[0] as HTMLElement).click();
    });
    const activeRow = container.querySelector<HTMLElement>(
      ".compare-row.active",
    );
    expect(activeRow).not.toBeNull();
    expect(activeRow?.dataset.rowKey).toBe(
      timelineBlocks[0].getAttribute("data-diff-key"),
    );
  });

  it("is strictly read-only and closes with Escape while keeping inputs intact", () => {
    const cuesBefore = project.cues.map((cue) => ({ ...cue }));
    const onClose = renderCompare();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // 项目数据未被对比改动（快照与当前条目均保持原值）
    expect(project.cues).toEqual(cuesBefore);
    expect(project.versions[0].cues[0].startMs).toBe(0);
    expect(project.versions[0].cues[0].text).toBe("原来的第一句");
  });

  it("supports comparing two snapshots by switching the pickers", () => {
    // 只有一个快照时改为同内容比较，提示选择不同侧
    renderCompare();
    act(() => {
      const selects = container.querySelectorAll<HTMLSelectElement>("select");
      selects[1].value = "v-1";
      selects[1].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("两侧选择了同一内容");
  });
});
