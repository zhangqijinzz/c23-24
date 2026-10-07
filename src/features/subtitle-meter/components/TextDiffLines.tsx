import type { CueLineDiff } from "../diff/diffTypes";

/** 一条文本改动的行级双行视图：旧行（红）在上、新行（绿）在下，公共字符保留 */
export function TextDiffLines({ lines }: { lines: CueLineDiff[] }) {
  return (
    <div className="diff-text-block">
      {lines.map((line, i) => {
        const segments =
          line.kind === "inserted" ? line.newSegments : line.oldSegments;
        return (
          <div
            key={`${line.lineNo}-${line.kind}-${i}`}
            className={`diff-line diff-line-${line.kind}`}
          >
            <span className="diff-line-no">{line.lineNo}</span>
            <span className="diff-line-mark">
              {line.kind === "equal"
                ? " "
                : line.kind === "deleted"
                  ? "−"
                  : "+"}
            </span>
            <span className="diff-line-text">
              {line.kind === "equal" && (!segments || !segments.length)
                ? " "
                : (segments ?? []).map((segment, j) => (
                    <span
                      key={j}
                      className={
                        segment.op === "equal"
                          ? "diff-char-equal"
                          : segment.op === "delete"
                            ? "diff-char-del"
                            : "diff-char-ins"
                      }
                    >
                      {segment.text || " "}
                    </span>
                  ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
