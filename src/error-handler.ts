/** Receives asynchronous errors that no caller awaits, such as backend reconnection failures. */
export type ErrorHandler = (error: Error) => void;

export const reportErrorToConsole: ErrorHandler = (error) => {
  console.error('tg-scheduler:', error);
};

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value), { cause: value });
}
