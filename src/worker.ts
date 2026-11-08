import type { Api } from 'grammy';
import {
  type BotQueueConfig,
  type BotJobProcessor,
  resolveBotQueueConfig,
  startBotJobProcessor,
} from './queue/bullmq.ts';
import type { BaseSchedulerOptions } from './base-scheduler-options.ts';
import { type BotPolicy, coordinateJob, parseBotPolicy } from './core/coordinator.ts';
import { createGrammyTransport } from './transport/grammy.ts';
import type { TelegramTransport } from './transport/telegram-transport.ts';

export interface SchedulerWorkerOptions extends BaseSchedulerOptions {
  /**
   * Caller-owned grammY API instance, used by reference for every admitted call. The caller owns
   * its token, rotation, timeout, endpoint and lifetime. Prefer a fresh instance without
   * transformers; any transformer must not retry, throttle, sleep or hide results and errors.
   */
  api: Api;
  /** Starting this worker sets the bot's shared dispatch capacity; the latest write wins. */
  policy?: BotPolicy;
}

/**
 * Claims one bot's due jobs and dispatches them through the caller's grammY API. Construction
 * validates options but performs no I/O. Runtime environment access and process signal handlers
 * stay in the host application. Unexpected processing errors and unawaited worker faults are
 * reported locally through `console.error`.
 */
export class SchedulerWorker {
  readonly #dispatchWorker: DispatchWorker;

  /** @throws {TypeError} when the bot identity, connection, queue prefix, policy, or API instance is invalid. */
  constructor(options: SchedulerWorkerOptions) {
    const transport = createGrammyTransport(parseApi(options.api));
    this.#dispatchWorker = new DispatchWorker(options, transport);
  }

  /**
   * Configure the bot's shared capacity and start claiming due jobs. Connection behavior follows
   * the supplied client. A failed start may be retried. Recurrence and job priorities are not
   * implemented yet.
   */
  start(): Promise<void> {
    return this.#dispatchWorker.start();
  }

  /**
   * Stop admission, drain active work, and close BullMQ resources.
   * The caller's connection and API instance remain usable.
   */
  close(): Promise<void> {
    return this.#dispatchWorker.close();
  }
}

/**
 * Check the members the transport uses. Constructor identity is not checked, so an instance from
 * the application's own grammY installation is accepted.
 */
function parseApi(api: unknown): Api {
  if (typeof api !== 'object' || api === null) {
    throw new TypeError('Invalid api: expected a grammY Api instance');
  }
  const { token, raw } = api as Partial<Record<'token' | 'raw', unknown>>;
  if (typeof token !== 'string' || typeof raw !== 'object' || raw === null) {
    throw new TypeError('Invalid api: expected a grammY Api instance');
  }
  return api as Api;
}

/**
 * The `SchedulerWorker` lifecycle around a given transport, such as a fake Telegram API in tests.
 * Errors name `SchedulerWorker` because they reach applications through it.
 */
export class DispatchWorker {
  readonly #config: BotQueueConfig;
  readonly #policy: Required<BotPolicy>;
  readonly #transport: TelegramTransport;
  #starting: Promise<BotJobProcessor> | undefined;
  #closing: Promise<void> | undefined;

  constructor(options: Omit<SchedulerWorkerOptions, 'api'>, transport: TelegramTransport) {
    this.#config = resolveBotQueueConfig(options);
    this.#policy = parseBotPolicy(options.policy);
    this.#transport = transport;
  }

  async start(): Promise<void> {
    if (this.#closing !== undefined) throw new Error('SchedulerWorker is closed');
    if (this.#starting !== undefined) throw new Error('SchedulerWorker is already started');
    const attempt = startBotJobProcessor(this.#config, {
      dispatchConcurrency: this.#policy.dispatchConcurrency,
      processJob: (job) => coordinateJob(job, { transport: this.#transport }),
    });
    this.#starting = attempt;
    try {
      await attempt;
    } catch (error) {
      if (this.#starting === attempt && this.#closing === undefined) this.#starting = undefined;
      throw error;
    }
  }

  close(): Promise<void> {
    this.#closing ??= this.#closeProcessor();
    return this.#closing;
  }

  async #closeProcessor(): Promise<void> {
    // A failed start has already released its resources.
    const processor = await this.#starting?.catch(() => undefined);
    await processor?.close();
  }
}
