import { createHash } from "node:crypto";
import type { AutomationSchedule } from "./types.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_CRON_SEARCH_DAYS = 366;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export interface AutomationJitterContext {
  installSalt: string;
  automationId: string;
}

function requireDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid automation ${label}: ${value}`);
  return date;
}

function parseTimeOfDay(value: string): { hours: number; minutes: number } {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) throw new Error("Time must use 24-hour HH:mm format.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error("Time must use 24-hour HH:mm format.");
  return { hours, minutes };
}

function formatTimeOfDay(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  let value: Intl.DateTimeFormat;
  try {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    value.format(new Date());
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  if (formatterCache.size >= 64) {
    const first = formatterCache.keys().next().value;
    if (first) formatterCache.delete(first);
  }
  formatterCache.set(timezone, value);
  return value;
}

function localParts(date: Date, timezone: string) {
  const parts = formatter(timezone).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = localParts(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

/** Converts an IANA-zone wall-clock slot to UTC, returning null for DST gaps. */
function zonedWallClockToUtc(input: { timezone: string; year: number; month: number; day: number; timeOfDay: string }): Date | null {
  const { hours, minutes } = parseTimeOfDay(input.timeOfDay);
  const naiveUtc = Date.UTC(input.year, input.month - 1, input.day, hours, minutes, 0, 0);
  const first = new Date(naiveUtc - timezoneOffsetMs(new Date(naiveUtc), input.timezone));
  const candidate = new Date(naiveUtc - timezoneOffsetMs(first, input.timezone));
  const roundTrip = localParts(candidate, input.timezone);
  return roundTrip.year === input.year
    && roundTrip.month === input.month
    && roundTrip.day === input.day
    && roundTrip.hour === hours
    && roundTrip.minute === minutes
    ? candidate
    : null;
}

function addLocalDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function localDayOfWeek(parts: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
}

function nextWallClock(
  schedule: Extract<AutomationSchedule, { type: "daily" | "weekdays" | "weekly" }>,
  from: Date,
): string | null {
  const start = localParts(from, schedule.timezone);
  for (let offset = 0; offset <= 370; offset += 1) {
    const date = addLocalDays(start, offset);
    const day = localDayOfWeek(date);
    if (schedule.type === "weekdays" && (day === 0 || day === 6)) continue;
    if (schedule.type === "weekly" && day !== schedule.dayOfWeek) continue;
    const candidate = zonedWallClockToUtc({ timezone: schedule.timezone, ...date, timeOfDay: schedule.timeOfDay });
    if (candidate && candidate.getTime() > from.getTime()) return candidate.toISOString();
  }
  return null;
}

interface CronField {
  values: ReadonlySet<number>;
  wildcard: boolean;
}

function parseCronNumber(raw: string | undefined, name: string): number {
  if (!raw || !/^\d+$/u.test(raw)) throw new Error(`Invalid cron ${name}.`);
  return Number(raw);
}

const dayNames = new Map([
  ["sun", 0], ["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5], ["sat", 6],
]);

function parseDay(raw: string | undefined, name: string): number {
  const named = raw ? dayNames.get(raw.toLowerCase()) : undefined;
  return named ?? parseCronNumber(raw, name);
}

function parseCronField(
  raw: string,
  min: number,
  max: number,
  name: string,
  parseValue = parseCronNumber,
  normalize = (value: number) => value,
): CronField {
  const values = new Set<number>();
  let wildcard = false;
  for (const token of raw.split(",")) {
    const [range = "", stepRaw] = token.trim().split("/");
    if (!range || token.trim().split("/").length > 2) throw new Error(`Invalid cron ${name}.`);
    const step = stepRaw === undefined ? 1 : parseCronNumber(stepRaw, name);
    if (step < 1) throw new Error(`Invalid cron ${name} step.`);
    if (range === "*" && stepRaw === undefined) wildcard = true;
    const bounds = range === "*" ? [String(min), String(max)] : range.split("-");
    if (bounds.length > 2) throw new Error(`Invalid cron ${name}.`);
    const start = parseValue(bounds[0], name);
    const end = parseValue(bounds[1] ?? bounds[0], name);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Cron ${name} is out of range.`);
    }
    for (let value = start; value <= end; value += step) values.add(normalize(value));
  }
  return { values, wildcard };
}

function parseCron(expression: string) {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) throw new Error("Cron schedules must use five fields: minute hour day-of-month month day-of-week.");
  return {
    minute: parseCronField(fields[0]!, 0, 59, "minute"),
    hour: parseCronField(fields[1]!, 0, 23, "hour"),
    dayOfMonth: parseCronField(fields[2]!, 1, 31, "day-of-month"),
    month: parseCronField(fields[3]!, 1, 12, "month"),
    dayOfWeek: parseCronField(fields[4]!, 0, 7, "day-of-week", parseDay, (value) => value === 7 ? 0 : value),
  };
}

function cronDayMatches(cron: ReturnType<typeof parseCron>, parts: { year: number; month: number; day: number }): boolean {
  const monthDay = cron.dayOfMonth.values.has(parts.day);
  const weekDay = cron.dayOfWeek.values.has(localDayOfWeek(parts));
  return cron.dayOfMonth.wildcard || cron.dayOfWeek.wildcard ? monthDay && weekDay : monthDay || weekDay;
}

function nextCron(schedule: Extract<AutomationSchedule, { type: "cron" }>, from: Date): string | null {
  formatter(schedule.timezone);
  const cron = parseCron(schedule.expression);
  const start = localParts(from, schedule.timezone);
  const hours = [...cron.hour.values].sort((left, right) => left - right);
  const minutes = [...cron.minute.values].sort((left, right) => left - right);
  for (let offset = 0; offset <= MAX_CRON_SEARCH_DAYS; offset += 1) {
    const date = addLocalDays(start, offset);
    if (!cron.month.values.has(date.month) || !cronDayMatches(cron, date)) continue;
    for (const hour of hours) {
      if (offset === 0 && hour < start.hour) continue;
      for (const minute of minutes) {
        if (offset === 0 && hour === start.hour && minute <= start.minute) continue;
        const candidate = zonedWallClockToUtc({ timezone: schedule.timezone, ...date, timeOfDay: formatTimeOfDay(hour, minute) });
        if (candidate && candidate.getTime() > from.getTime()) return candidate.toISOString();
      }
    }
  }
  return null;
}

function jitterMs(schedule: AutomationSchedule, context?: AutomationJitterContext): number {
  if (!context || !["daily", "weekdays", "weekly", "cron"].includes(schedule.type)) return 0;
  const digest = createHash("sha256").update(`${context.installSalt}:${context.automationId}`).digest();
  let value = 0;
  for (const byte of digest) value = (value * 256 + byte) % 120;
  return value * 1_000;
}

function addJitter(value: string | null, milliseconds: number): string | null {
  return value ? new Date(Date.parse(value) + milliseconds).toISOString() : null;
}

export function validateAutomationSchedule(schedule: AutomationSchedule): void {
  if (schedule.type === "manual") return;
  if (schedule.type === "once") {
    requireDate(schedule.runAt, "run time");
    return;
  }
  if (schedule.type === "interval") {
    if (!Number.isInteger(schedule.everyMinutes) || schedule.everyMinutes < 1 || schedule.everyMinutes > 525_600) {
      throw new Error("Intervals must be between 1 minute and 1 year.");
    }
    return;
  }
  formatter(schedule.timezone);
  if (schedule.type === "cron") {
    parseCron(schedule.expression);
    return;
  }
  parseTimeOfDay(schedule.timeOfDay);
  if (schedule.type === "weekly" && (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6)) {
    throw new Error("Weekly schedules require a day from Sunday through Saturday.");
  }
}

export function computeNextAutomationRunAt(
  schedule: AutomationSchedule,
  fromIso: string,
  context?: AutomationJitterContext,
): string | null {
  validateAutomationSchedule(schedule);
  if (schedule.type === "manual") return null;
  const from = requireDate(fromIso, "cursor");
  if (schedule.type === "once") {
    const runAt = requireDate(schedule.runAt, "run time");
    return runAt.getTime() > from.getTime() ? runAt.toISOString() : null;
  }
  if (schedule.type === "interval") return new Date(from.getTime() + schedule.everyMinutes * MINUTE_MS).toISOString();
  const jitter = jitterMs(schedule, context);
  const base = new Date(from.getTime() - jitter);
  return addJitter(schedule.type === "cron" ? nextCron(schedule, base) : nextWallClock(schedule, base), jitter);
}

/** Coalesces downtime: returns the first future slot instead of replaying every missed occurrence. */
export function computeNextAutomationRunAtAfter(
  schedule: AutomationSchedule,
  previousIso: string,
  notBeforeIso: string,
  context?: AutomationJitterContext,
): string | null {
  if (schedule.type === "manual" || schedule.type === "once") return null;
  if (schedule.type === "interval") {
    const previous = requireDate(previousIso, "cursor").getTime();
    const floor = requireDate(notBeforeIso, "catch-up cursor").getTime();
    const step = schedule.everyMinutes * MINUTE_MS;
    let next = previous + step;
    if (next <= floor) next += Math.ceil((floor - next + 1) / step) * step;
    return new Date(next).toISOString();
  }
  return computeNextAutomationRunAt(schedule, notBeforeIso, context);
}
