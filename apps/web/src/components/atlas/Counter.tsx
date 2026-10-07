import { useEffect, useRef, useState } from "react";

/** A number that rolls to its new value like an odometer. */
export const RollingNumber = ({ value, format }: { value: number; format?: (n: number) => string }) => {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduced || start === value) {
      setShown(value);
      from.current = value;
      return;
    }
    const began = performance.now();
    const duration = 450;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value]);
  return <>{format ? format(shown) : shown.toLocaleString()}</>;
};

export const Counter = ({ value, label, format }: { value: number; label: string; format?: (n: number) => string }) => (
  <div className="atlas-counter">
    <span className="atlas-counter__value">
      <RollingNumber value={value} format={format} />
    </span>
    <span className="atlas-counter__label">{label}</span>
  </div>
);
