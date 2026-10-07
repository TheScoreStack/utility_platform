import clsx from "clsx";
import { ATLAS_CIRCLE_COLORS, type AtlasCircle, type AtlasCircleColor } from "../../types";
import { ALL_HEX, CIRCLE_HEX } from "../../modules/atlas/lens";

export const CircleChip = ({
  circle,
  active,
  count,
  onClick
}: {
  circle?: AtlasCircle;
  active: boolean;
  count?: number;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={clsx("atlas-chip", active && "atlas-chip--on")}
    style={{ ["--chip" as string]: circle ? CIRCLE_HEX[circle.color] : ALL_HEX }}
    aria-pressed={active}
    onClick={onClick}
  >
    {circle && <span className="atlas-chip__dot" aria-hidden="true" />}
    <span>{circle ? circle.name : "All"}</span>
    {count !== undefined && <span className="atlas-chip__count">{count}</span>}
  </button>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) => (
  <div className="atlas-seg" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        className={clsx("atlas-seg__btn", value === o.value && "atlas-seg__btn--on")}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Stars = ({ value, onChange }: { value?: number; onChange?: (v: number | undefined) => void }) => (
  <div className="atlas-stars" role={onChange ? "radiogroup" : undefined} aria-label="Rating">
    {[1, 2, 3, 4, 5].map((n) =>
      onChange ? (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} of 5`}
          className={clsx("atlas-stars__dot", value && n <= value && "atlas-stars__dot--on")}
          onClick={() => onChange(value === n ? undefined : n)}
        />
      ) : (
        <span key={n} className={clsx("atlas-stars__dot", value && n <= value && "atlas-stars__dot--on")} />
      )
    )}
  </div>
);

export const ColorSwatches = ({ value, onChange }: { value: AtlasCircleColor; onChange: (c: AtlasCircleColor) => void }) => (
  <div className="atlas-swatches" role="radiogroup" aria-label="Circle color">
    {ATLAS_CIRCLE_COLORS.map((c) => (
      <button
        key={c}
        type="button"
        role="radio"
        aria-checked={value === c}
        aria-label={c}
        className={clsx("atlas-swatch", value === c && "atlas-swatch--on")}
        style={{ background: CIRCLE_HEX[c] }}
        onClick={() => onChange(c)}
      />
    ))}
  </div>
);
