/**
 * Last line of defence against secrets in logs. Structured fields are redacted by path in
 * the logger config; this scrubs free text (messages, error messages, stack traces), where
 * credentials typically leak by accident: connection strings, bearer tokens, JWTs, key=value pairs.
 */

export const REDACTED = "[REDACTED]";

const PATTERNS: readonly (readonly [RegExp, string])[] = [
  // scheme://user:password@host → scheme://user:[REDACTED]@host (user may be empty: redis://:pw@host)
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  // Authorization: Bearer <token>
  [/\b(bearer\s+)[a-z0-9._~+/-]+=*/gi, `$1${REDACTED}`],
  // JSON Web Tokens (Firebase ID tokens, App Check tokens)
  [/\beyJ[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\.[a-z0-9_-]+/gi, REDACTED],
  // password=..., token: ..., api_key=..., secret=... (query strings, config dumps)
  [
    /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi,
    `$1${REDACTED}`,
  ],
];

export function redactString(value: string): string {
  let result = value;
  for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

/** Field paths the logger censors in structured objects (pino `redact` syntax). */
export const REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-firebase-appcheck"]',
  'res.headers["set-cookie"]',
  "*.authorization",
  "*.password",
  "*.token",
  "*.idToken",
  "*.refreshToken",
  "*.secret",
  "*.apiKey",
  "*.privateKey",
  "*.databaseUrl",
  "*.DATABASE_URL",
  "*.REDIS_URL",
];
