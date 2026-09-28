/**
 * Framework-free error type shared by route handlers and the worker. Kept out
 * of lib/http.ts so worker bundles never import Next.js.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
