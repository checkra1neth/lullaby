// Server-only structured logger with PII redaction.
//
// Requirement 18 (see .kiro/specs/lullaby-personalized/requirements.md):
//   18.1 redact child_name, child_age, favorites, parent_email, from_name
//        from message body, structured fields, and stack traces; placeholder
//        ≤16 chars and contains no portion of the original PII value.
//   18.2 logs reference PII only via order_id or lullaby_asset_id.
//   18.3 strip PII from captured exception context while preserving order_id.
//   18.4 if redaction throws, drop the entry and emit a synthetic
//        redaction_failed entry instead.
//   18.5 redaction is bounded; benchmark in tests/unit/log.bench.spec.ts.
//
// Public API:
//   log.info(payload)
//   log.warn(payload)
//   log.error(payload, error?)
//
// Special payload fields:
//   - `pii`: optional string[] of the in-scope Order's PII values. Used to
//     build a per-call regex that masks those literal substrings inside any
//     remaining free-form string (e.g. Error.message / Error.stack). The
//     `pii` array itself is never written to output.
//   - `order_id`: optional string used as the trace anchor and as the
//     reference in the synthetic redaction_failed entry.

const PII_KEY_REGEX =
  /parent_email|child_name|child_age|favorites|from_name|email|name/i;

const REDACTED = "[redacted]";

type LogLevel = "info" | "warn" | "error";

export interface LogPayload {
  [key: string]: unknown;
  /** Literal PII values to mask inside free-form strings (e.g. Error.message). */
  pii?: readonly string[];
  /** Trace anchor; preserved through redaction. */
  order_id?: string;
  /** Optional asset reference; preserved through redaction. */
  lullaby_asset_id?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildValueRegex(pii: readonly string[] | undefined): RegExp | null {
  if (!pii || pii.length === 0) return null;
  const parts: string[] = [];
  for (const raw of pii) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    parts.push(escapeRegex(trimmed));
  }
  if (parts.length === 0) return null;
  return new RegExp(parts.join("|"), "gi");
}

function maskString(s: string, valueRegex: RegExp | null): string {
  if (!valueRegex) return s;
  // Reset lastIndex defensively in case of /g flag reuse.
  valueRegex.lastIndex = 0;
  return s.replace(valueRegex, REDACTED);
}

function redactValue(
  value: unknown,
  keyMatched: boolean,
  valueRegex: RegExp | null,
  seen: WeakSet<object>,
): unknown {
  if (keyMatched) return REDACTED;
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") {
    return maskString(value as string, valueRegex);
  }
  if (t === "number" || t === "boolean") {
    return value;
  }
  if (t === "bigint") {
    return (value as bigint).toString();
  }
  if (t === "function" || t === "symbol") {
    // Drop non-serializable shapes rather than risking a JSON.stringify throw.
    return undefined;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return (value as unknown[]).map((v) =>
      redactValue(v, false, valueRegex, seen),
    );
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return "[circular]";
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const keyHit = PII_KEY_REGEX.test(k);
      out[k] = redactValue(obj[k], keyHit, valueRegex, seen);
    }
    return out;
  }
  return undefined;
}

function emitRaw(level: LogLevel, entry: Record<string, unknown>): void {
  const line = JSON.stringify({ level, ...entry });
  // eslint-disable-next-line no-console -- log boundary writes once, here.
  if (level === "error") console.error(line);
  // eslint-disable-next-line no-console
  else if (level === "warn") console.warn(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

function redactPayload(
  payload: LogPayload | undefined,
  error: Error | undefined,
): Record<string, unknown> {
  const safe: LogPayload = payload ?? {};
  // The `pii` array itself is PII — strip it from output (Req 18.1).
  const { pii, ...rest } = safe;
  const valueRegex = buildValueRegex(pii);
  const seen = new WeakSet<object>();

  const redacted = redactValue(rest, false, valueRegex, seen) as Record<
    string,
    unknown
  >;

  if (error) {
    const name =
      typeof error.name === "string" && error.name.length > 0
        ? error.name
        : "Error";
    const message =
      typeof error.message === "string" ? error.message : String(error);
    const stack = typeof error.stack === "string" ? error.stack : "";
    redacted.error = {
      name,
      message: maskString(message, valueRegex),
      stack: maskString(stack, valueRegex),
    };
  }

  return redacted;
}

function logImpl(
  level: LogLevel,
  payload: LogPayload | undefined,
  error?: Error,
): void {
  let orderIdForFallback: string | undefined;
  try {
    orderIdForFallback =
      typeof payload?.order_id === "string" ? payload.order_id : undefined;

    const entry = redactPayload(payload, error);
    emitRaw(level, entry);
  } catch {
    // Req 18.4: drop the entry, emit a synthetic non-PII record. The
    // synthetic entry is built by hand (no recursion through redactPayload)
    // so it cannot trigger another redactor throw.
    try {
      emitRaw("warn", {
        event: "redaction_failed",
        order_id: orderIdForFallback,
      });
    } catch {
      // Last-ditch: give up silently rather than crashing the request.
    }
  }
}

export const log = {
  info(payload: LogPayload): void {
    logImpl("info", payload);
  },
  warn(payload: LogPayload): void {
    logImpl("warn", payload);
  },
  error(payload: LogPayload, error?: Error): void {
    logImpl("error", payload, error);
  },
};

// Exported for tests only.
export const __internal = {
  PII_KEY_REGEX,
  REDACTED,
  redactPayload,
  buildValueRegex,
};
