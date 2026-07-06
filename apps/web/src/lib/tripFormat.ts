export const formatDate = (isoString: string) => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

export const formatTime = (isoString: string): string => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
};

export const localDayKey = (isoString: string): string => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "unknown";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const formatDayLabel = (isoString: string): { primary: string; secondary?: string } => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return { primary: "Unknown date" };
  const today = new Date();
  const todayKey = localDayKey(today.toISOString());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday.toISOString());
  const dayKey = localDayKey(isoString);

  const dateLabel = (() => {
    if (dayKey === todayKey) return "Today";
    if (dayKey === yesterdayKey) return "Yesterday";
    try {
      const includeYear = date.getFullYear() !== today.getFullYear();
      return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        ...(includeYear ? { year: "numeric" } : {})
      }).format(date);
    } catch {
      return date.toDateString();
    }
  })();

  let secondary: string | undefined;
  try {
    secondary = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric"
    }).format(date);
    if (dayKey === todayKey || dayKey === yesterdayKey) {
      // For Today/Yesterday, secondary already adds value (the actual date)
    } else {
      // For full date labels the secondary would be redundant
      secondary = undefined;
    }
  } catch {
    secondary = undefined;
  }

  return { primary: dateLabel, secondary };
};


/** Parse date-only strings ("2025-09-26") as local midnight, not UTC —
 *  otherwise they render a day early in western timezones. */
const parseLocalDay = (iso: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);

/** "SEP 25 – SEP 27" passport-stamp range for trip cards. */
export const formatTripStamp = (
  startDate?: string | null,
  endDate?: string | null
): string | null => {
  const fmt = (iso: string) => {
    const d = parseLocalDay(iso);
    if (Number.isNaN(d.getTime())) return iso;
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric"
      })
        .format(d)
        .toUpperCase();
    } catch {
      return iso;
    }
  };
  if (!startDate && !endDate) return null;
  if (startDate && endDate && startDate !== endDate) {
    return `${fmt(startDate)} – ${fmt(endDate)}`;
  }
  return fmt(startDate ?? endDate!);
};

/** "September 25 → September 27, 2025" long-form trip date range. */
export const formatTripRange = (
  startDate?: string | null,
  endDate?: string | null
): string => {
  if (!startDate && !endDate) return "Flexible dates";
  const fmt = (iso: string) => {
    const d = parseLocalDay(iso);
    if (Number.isNaN(d.getTime())) return iso;
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year:
          d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined
      }).format(d);
    } catch {
      return iso;
    }
  };
  if (startDate && endDate && startDate !== endDate) {
    return `${fmt(startDate)} → ${fmt(endDate)}`;
  }
  return fmt(startDate ?? endDate!);
};
