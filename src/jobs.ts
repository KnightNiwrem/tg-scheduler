import type { TelegramMethod, TelegramResult } from './telegram.ts';

export type DeliveryLane = 'ordinary' | 'urgent';

export interface SubmitOptions {
  /** Earliest execution time in Unix epoch milliseconds; omission means immediate work. */
  runAtMs?: number;
  /** Defaults to ordinary. Urgent work requires enabled bypass and an allowlisted method. */
  lane?: DeliveryLane;
}

export interface JobHandle<Method extends TelegramMethod = TelegramMethod> {
  id: string;
  method: Method;
}

/** Stored errors must be serializable and exclude tokens and credential-bearing URLs. */
export interface JobError {
  message: string;
  telegramErrorCode?: number;
}

/** Outcomes that end a job. A definite 429 is not one: the job returns to queued. */
export type SettledJobOutcome<Method extends TelegramMethod = TelegramMethod> =
  | { state: 'succeeded'; result: TelegramResult<Method> }
  | { state: 'failed'; error: JobError }
  | { state: 'uncertain'; error: JobError };

export type JobOutcome<Method extends TelegramMethod = TelegramMethod> =
  | { state: 'queued' }
  | { state: 'in-flight' }
  | SettledJobOutcome<Method>;

/** Narrow method and state to retrieve the corresponding Telegram result type. */
export type JobSnapshot = {
  [Method in TelegramMethod]: JobHandle<Method> & {
    botId: string;
    originalDueAtMs: number;
    lane: DeliveryLane;
  } & JobOutcome<Method>;
}[TelegramMethod];
