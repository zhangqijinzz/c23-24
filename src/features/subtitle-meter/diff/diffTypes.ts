import type { SubtitleCue } from "../models";
import type { CharSegment } from "./textLcs";

export type DiffChangeKind =
  | "added"
  | "deleted"
  | "text"
  | "time"
  | "both"
  | "same";

export interface CueLineDiff {
  /** 旧文本中的行号（纯新增行沿用前一行号） */
  lineNo: number;
  kind: "equal" | "deleted" | "inserted";
  oldSegments?: CharSegment[];
  newSegments?: CharSegment[];
}

export interface CueDiff {
  key: string;
  kind: DiffChangeKind;
  cueA: SubtitleCue | null;
  cueB: SubtitleCue | null;
  indexA: number | null;
  indexB: number | null;
  startDeltaMs: number;
  endDeltaMs: number;
  lines: CueLineDiff[];
}

export interface VersionDiffStats {
  added: number;
  deleted: number;
  text: number;
  time: number;
  same: number;
}

export interface VersionDiff {
  entries: CueDiff[];
  stats: VersionDiffStats;
  total: number;
}

export interface DiffSide {
  id: string;
  label: string;
  cues: SubtitleCue[];
}
