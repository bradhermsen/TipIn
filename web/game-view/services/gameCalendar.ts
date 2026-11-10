const centralDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
});

export function centralDayKey(value: string | Date): string {
  // API timestamps without an offset are scheduled Central wall-clock values.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid game calendar date.");
  const parts = centralDate.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isScheduledToday(game: { status?: string | null; gameDateTime: string }, now = new Date()): boolean {
  return String(game.status || "").trim().toUpperCase() === "SCHEDULED"
    && centralDayKey(game.gameDateTime) === centralDayKey(now);
}
