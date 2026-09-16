const SECRET_KEY = /password|passwd|secret|token|cookie|authorization|api[_-]?key|credential|storage[_-]?state/i;

export function redact(value: unknown, sensitiveKeys: ReadonlySet<string> = new Set(), sensitiveValues: ReadonlySet<string> = new Set()): unknown {
  if (typeof value === "string") {
    let clean = value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
    for (const secret of sensitiveValues) if (secret) clean = clean.replaceAll(secret, "[REDACTED]");
    return clean;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, sensitiveKeys, sensitiveValues));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) || sensitiveKeys.has(key) ? "[REDACTED]" : redact(item, sensitiveKeys, sensitiveValues),
    ]));
  }
  return value;
}
