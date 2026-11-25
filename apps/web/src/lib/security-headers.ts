import type { WebEnv } from "../env";

export interface Header {
  key: string;
  value: string;
}

const origin = (url: string) => /^(https?:\/\/[^/]+)/i.exec(url)?.[1] ?? url;

/**
 * Content-Security-Policy for the website (Prompt 27, OWASP ASVS V14.4). Scripts load only
 * from this site; data goes only to the FleetTrust API and Firebase Auth; nothing may frame
 * the site.
 *
 * Accepted risk: `'unsafe-inline'` for scripts and styles. Next.js inlines its bootstrap
 * scripts and the components use style attributes; nonces would make every page dynamic.
 * The rest of the policy (no third-party scripts, no framing, no plugins, fixed connect
 * targets) still limits what injected markup could do, and React escapes all output.
 */
export function contentSecurityPolicy(env: WebEnv, options: { development: boolean }): string {
  const api = origin(env.apiUrl);
  const emulator = env.firebase.authEmulatorHost ? `http://${env.firebase.authEmulatorHost}` : null;
  const firebaseAuth = `https://${env.firebase.authDomain}`;
  const connect = [
    "'self'",
    api,
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    ...(emulator ? [emulator] : []),
  ];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(options.development ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Map tiles (vendor set by the API, OQ-13), provider media and data: placeholders.
    "img-src": ["'self'", "data:", "blob:", "https:", api],
    "font-src": ["'self'"],
    "connect-src": connect,
    // Google and Apple sign-in run on the Firebase auth domain.
    "frame-src": [firebaseAuth, ...(emulator ? [emulator] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (env.appEnv === "production" || env.appEnv === "staging")
    policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** Headers for every page (next.config.ts). */
export function securityHeaders(env: WebEnv, options: { development: boolean }): Header[] {
  const deployed = env.appEnv === "production" || env.appEnv === "staging";
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env, options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "geolocation=(self), camera=(), microphone=(), payment=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ...(deployed
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : []),
  ];
}
