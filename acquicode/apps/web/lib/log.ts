import pino from 'pino';
import { redactSecrets } from '@acquicode/engine';

/**
 * Structured logs. Never log repository content, dossier bodies, secrets,
 * tokens or cookies: the redact list is a backstop, not the policy.
 */
let logger: pino.Logger | null = null;

export function log(): pino.Logger {
  if (logger) return logger;
  logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: process.env.ACQUICODE_SERVICE ?? 'web' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.token',
        '*.accessToken',
        '*.access_token',
        '*.password',
        '*.secret',
        '*.privateKey',
        '*.credential',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[redacted]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return logger;
}

/** Strip anything that looks like a credential from an error message before storing or logging it. */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Provider formats (cloud keys, Stripe, Slack, …) come from the engine's secret rules.
  return redactSecrets(msg.slice(0, 4000))
    .replace(/\/\/[^@/\s]+@/g, '//[redacted]@')
    .replace(/\b(gh[pousr]_|github_pat_|glpat-|x-access-token:|acq_|shr_|sess_)[A-Za-z0-9_.-]+/g, '$1[redacted]')
    .replace(/(authorization:\s*)(bearer|basic)\s+\S+/gi, '$1$2 [redacted]')
    .replace(/(private-token:\s*)\S+/gi, '$1[redacted]')
    .slice(0, 1000);
}
