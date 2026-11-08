/**
 * Local diagnostics for errors that no awaited operation reports. There is no public callback for
 * these; see the internal error reporting decision.
 */

/** A queue connection event outside an awaited client operation. */
export function warnUnawaitedQueueError(error: Error): void {
  console.warn('tg-scheduler:', error);
}

/** An unexpected internal exception or unawaited worker fault, with its original stack. */
export function reportInternalError(error: Error): void {
  console.error('tg-scheduler:', error);
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value), { cause: value });
}
