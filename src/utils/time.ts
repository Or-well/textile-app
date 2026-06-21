export function nowIso(): string {
  return new Date().toISOString();
}

export interface DateTimeFormatOptions {
  timeZone?: string;
  includeTimeZone?: boolean;
  seconds?: boolean;
}

export type DateTimeDisambiguation = "earlier" | "later" | "reject";

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const EXPLICIT_TIME_ZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseLocalDateTime(value: string): LocalDateTimeParts | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const validationDate = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );

  if (
    validationDate.getUTCFullYear() !== parts.year ||
    validationDate.getUTCMonth() + 1 !== parts.month ||
    validationDate.getUTCDate() !== parts.day ||
    validationDate.getUTCHours() !== parts.hour ||
    validationDate.getUTCMinutes() !== parts.minute ||
    validationDate.getUTCSeconds() !== parts.second
  ) {
    return null;
  }

  return parts;
}

function getZonedParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function sameLocalDateTime(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts,
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return zonedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function hasExplicitTimeZone(value: string): boolean {
  return EXPLICIT_TIME_ZONE_PATTERN.test(value.trim());
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function getCurrentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function getSupportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const values = intl.supportedValuesOf?.("timeZone") ?? [];

  return Array.from(new Set(["UTC", getCurrentTimeZone(), ...values])).sort(
    (left, right) => left.localeCompare(right),
  );
}

export function getInstantValue(value: string | Date | undefined): number | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string" && !hasExplicitTimeZone(value)) {
    return null;
  }

  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeInstant(value: string): string {
  if (!hasExplicitTimeZone(value)) {
    return "";
  }

  const timestamp = getInstantValue(value);

  return timestamp === null ? "" : new Date(timestamp).toISOString();
}

export function compareInstants(
  left: string | undefined,
  right: string | undefined,
): number {
  const leftTime = getInstantValue(left);
  const rightTime = getInstantValue(right);

  if (leftTime === null && rightTime === null) {
    return 0;
  }

  if (leftTime === null) {
    return 1;
  }

  if (rightTime === null) {
    return -1;
  }

  return leftTime - rightTime;
}

export function utcDateKey(value: string | Date = new Date()): string {
  const timestamp = getInstantValue(value);

  if (timestamp === null) {
    throw new Error("无效时间，无法生成 UTC 日期。");
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

export function formatDateTimeLocalInput(
  value: string | Date,
  timeZone = getCurrentTimeZone(),
): string {
  const timestamp = getInstantValue(value);

  if (timestamp === null || !isValidTimeZone(timeZone)) {
    return "";
  }

  const parts = getZonedParts(new Date(timestamp), timeZone);

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function getZonedDateTimeCandidates(
  localValue: string,
  timeZone: string,
): string[] {
  const localParts = parseLocalDateTime(localValue);

  if (!localParts || !isValidTimeZone(timeZone)) {
    return [];
  }

  const localAsUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
  );
  const offsets = new Set<number>();

  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = new Date(localAsUtc + hours * 60 * 60 * 1000);
    offsets.add(getTimeZoneOffsetMs(sample, timeZone));
  }

  return [...offsets]
    .map((offset) => new Date(localAsUtc - offset))
    .filter((candidate) =>
      sameLocalDateTime(getZonedParts(candidate, timeZone), localParts),
    )
    .map((candidate) => candidate.toISOString())
    .filter((value, index, rows) => rows.indexOf(value) === index)
    .sort();
}

export function zonedDateTimeToUtc(
  localValue: string,
  timeZone: string,
  disambiguation: DateTimeDisambiguation = "reject",
): string {
  if (!parseLocalDateTime(localValue)) {
    throw new Error("截止时间格式无效。");
  }

  if (!isValidTimeZone(timeZone)) {
    throw new Error("请选择有效的 IANA 时区。");
  }

  const candidates = getZonedDateTimeCandidates(localValue, timeZone);

  if (candidates.length === 0) {
    throw new Error("该本地时间因夏令时切换而不存在，请选择其他时间。");
  }

  if (candidates.length > 1 && disambiguation === "reject") {
    throw new Error("该本地时间在夏令时切换中出现两次，请选择较早或较晚时刻。");
  }

  return disambiguation === "later"
    ? candidates[candidates.length - 1]
    : candidates[0];
}

export function formatDateTime(
  value: string | Date,
  options: DateTimeFormatOptions = {},
): string {
  if (typeof value === "string" && !hasExplicitTimeZone(value)) {
    return "";
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const timeZone = options.timeZone;
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: options.seconds === false ? undefined : "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);

  if (!options.includeTimeZone) {
    return formatted;
  }

  const resolvedTimeZone =
    timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return `${formatted} (${resolvedTimeZone})`;
}
