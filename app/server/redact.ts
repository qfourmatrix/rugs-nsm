const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /api[-_]?key/i,
  /token/i,
  /secret/i,
  /password/i
];

function redactString(value: string, secrets: string[]): string {
  let output = value;
  for (const secret of secrets) {
    if (secret) {
      output = output.split(secret).join(REDACTED);
    }
  }
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  return output;
}

export function redactSecrets(value: unknown, secrets: Array<string | null | undefined> = []): unknown {
  const presentSecrets = secrets.filter((secret): secret is string => Boolean(secret));

  if (typeof value === "string") {
    return redactString(value, presentSecrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, presentSecrets));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(record)) {
      if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        redacted[key] = REDACTED;
      } else {
        redacted[key] = redactSecrets(child, presentSecrets);
      }
    }

    return redacted;
  }

  return value;
}
