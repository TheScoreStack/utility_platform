import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { AtlasCircle, AtlasCircleColor, AtlasLens } from "../../types";

export type AtlasShow = "been" | "want";

/**
 * Lens state lives in the URL (?mode=flights&circle=…&from=2018), so Back
 * steps through lenses and any view can be linked or bookmarked.
 */
export const useLens = () => {
  const [params, setParams] = useSearchParams();

  const lens = useMemo<AtlasLens>(() => {
    const from = Number(params.get("from"));
    const to = Number(params.get("to"));
    return {
      mode: params.get("mode") === "flights" ? "flights" : "footprint",
      circle: params.get("circle") || "all",
      fromYear: from ? from : undefined,
      toYear: to ? to : undefined
    };
  }, [params]);
  const show: AtlasShow = params.get("show") === "want" ? "want" : "been";
  const country = params.get("country") ?? undefined;

  const update = useCallback(
    (changes: Record<string, string | number | undefined>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            const isDefault =
              value === undefined ||
              value === "" ||
              (key === "mode" && value === "footprint") ||
              (key === "circle" && value === "all") ||
              (key === "show" && value === "been");
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  return { lens, show, country, update, search: params.toString() };
};

/** Hues for each circle color key; tuned to read on the dark map. */
export const CIRCLE_HEX: Record<AtlasCircleColor, string> = {
  rose: "#f472b6",
  amber: "#fbbf24",
  emerald: "#34d399",
  sky: "#38bdf8",
  violet: "#a78bfa",
  coral: "#fb7185",
  teal: "#2dd4bf",
  slate: "#94a3b8"
};

/** The "All" lens paints with the platform accent. */
export const ALL_HEX = "#748ffc";

export const circleHex = (circles: AtlasCircle[], circleId: string): string => {
  const circle = circles.find((c) => c.circleId === circleId);
  return circle ? CIRCLE_HEX[circle.color] : ALL_HEX;
};

/** The color a trip wears in lists: its first circle, else the accent. */
export const tripHex = (circles: AtlasCircle[], circleIds: string[]): string =>
  circleIds.length ? circleHex(circles, circleIds[0]) : ALL_HEX;
