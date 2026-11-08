import type { TelegramMethod, TelegramResult } from './telegram.ts';

/** Relative preference among a bot's queued jobs; both priorities share capacity and cooldown. */
export type JobPriority = 'normal' | 'urgent';

export interface SubmitOptions {
  /** Earliest execution time in Unix epoch milliseconds; omitted or past times mean immediate work. */
  runAtMs?: number;
  /** Defaults to normal. Urgent submissions currently reject as unimplemented. */
  priority?: JobPriority;
}

export interface JobHandle<Method extends TelegramMethod = TelegramMethod> {
  /** Opaque identifier assigned by the backend. */
  id: string;
  method: Method;
}

/** Stored errors must be serializable and exclude tokens and credential-bearing URLs. */
export interface JobError {
  message: string;
  telegramErrorCode?: number;
}

/** Terminal execution outcomes. Failure does not prove Telegram did not perform the call. */
export type SettledJobOutcome<Method extends TelegramMethod = TelegramMethod> =
  | { state: 'succeeded'; result: TelegramResult<Method> }
  | { state: 'failed'; error: JobError };

export type JobOutcome<Method extends TelegramMethod = TelegramMethod> =
  | { state: 'queued' }
  | { state: 'in-flight' }
  | SettledJobOutcome<Method>;

/** Narrow method and state to retrieve the corresponding Telegram result type. */
export type JobSnapshot = {
  [Method in TelegramMethod]: JobHandle<Method> & {
    botId: string;
    /** Native initial eligibility time in Unix epoch milliseconds, preserved after execution. */
    scheduledForMs: number;
    priority: JobPriority;
  } & JobOutcome<Method>;
}[TelegramMethod];
