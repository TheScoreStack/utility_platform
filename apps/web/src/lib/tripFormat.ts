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
