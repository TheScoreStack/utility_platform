import clsx from "clsx";

export type StepState = "done" | "current" | "upcoming" | "locked";

/**
 * Wizard steps as pills you can click: a number (or a check once that step
 * is actually complete) plus the label. A skipped step keeps its number, so a
 * missing date stands out. Locked steps are dimmed and inert.
 */
export const StepIndicator = ({
  steps,
  current,
  isLocked,
  isComplete,
  onSelect
}: {
  steps: readonly string[];
  current: number;
  isLocked: (index: number) => boolean;
  isComplete: (index: number) => boolean;
  onSelect: (index: number) => void;
}) => (
  <ol className="atlas-steps" aria-label="Steps">
    {steps.map((label, i) => {
      const state: StepState = isLocked(i)
        ? "locked"
        : i === current
          ? "current"
          : isComplete(i)
            ? "done"
            : "upcoming";
      const stateWord = { done: "completed", current: "current", upcoming: "not done yet", locked: "add a place first" }[state];
      return (
        <li key={label} className="atlas-steps__item">
          <button
            type="button"
            className={clsx("atlas-steps__pill", `atlas-steps__pill--${state}`)}
            aria-current={state === "current" ? "step" : undefined}
            aria-label={`Step ${i + 1} of ${steps.length}, ${label}, ${stateWord}`}
            disabled={state === "locked"}
            onClick={() => onSelect(i)}
          >
            <span className="atlas-steps__badge" aria-hidden="true">
              {state === "done" ? (
                <svg viewBox="0 0 12 12" width="11" height="11">
                  <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="atlas-steps__label">{label}</span>
          </button>
        </li>
      );
    })}
  </ol>
);
