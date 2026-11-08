import type { Api } from 'grammy';
import {
  type BotJobProcessor,
  resolveBotBackendConfig,
  startBotJobProcessor,
} from './backend/bullmq.ts';
import { type BotPolicy, coordinateJob, parseBotPolicy } from './core/coordinator.ts';
import type { SharedBotOptions } from './shared-bot-options.ts';
import { createGrammyTransport } from './transport/grammy.ts';
import type { TelegramTransport } from './transport/telegram-transport.ts';

export interface SchedulerWorkerOptions extends SharedBotOptions {
  /**
   * Caller-owned grammY API instance, used by reference for every admitted call. The caller owns
   * its token, rotation, timeout, endpoint and lifetime. Prefer a fresh instance without
   * transformers; any transformer must not retry, throttle, sleep or hide results and errors.
   */
  api: Api;
  /** Starting this worker sets the bot's shared dispatch capacity; the latest write wins. */
  policy?: BotPolicy;
}

export interface SchedulerWorker {
  /**
   * Configure the bot's shared capacity and start claiming due jobs. Connection behavior follows
   * the supplied client. A failed start may be retried. Recurrence and job priorities are not
   * implemented yet.
   */
  start(): Promise<void>;
  /**
   * Stop admission, drain active work, and close BullMQ resources.
   * The caller's connection and API instance remain usable.
   */
  close(): Promise<void>;
}

/**
 * Construction validates options but performs no I/O. Runtime environment access and process
 * signal handlers stay in the host application. Unexpected processing errors and unawaited worker
 * faults are reported locally through `console.error`.
 *
 * @throws {TypeError} when the bot identity, backend options, policy, or API instance is invalid.
 */
export function createSchedulerWorker(options: SchedulerWorkerOptions): SchedulerWorker {
  return createSchedulerWorkerWithTransport(options, createGrammyTransport(parseApi(options.api)));
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

/** Assemble a worker around a given transport, such as a fake Telegram API in tests. */
export function createSchedulerWorkerWithTransport(
  options: Omit<SchedulerWorkerOptions, 'api'>,
  transport: TelegramTransport,
): SchedulerWorker {
  const config = resolveBotBackendConfig(options.botId, options.backend);
  const policy = parseBotPolicy(options.policy);
  let starting: Promise<BotJobProcessor> | undefined;
  let closing: Promise<void> | undefined;

  async function closeProcessor(): Promise<void> {
    // A failed start has already released its resources.
    const processor = await starting?.catch(() => undefined);
    await processor?.close();
  }

  return {
    async start() {
      if (closing !== undefined) throw new Error('SchedulerWorker is closed');
      if (starting !== undefined) throw new Error('SchedulerWorker is already started');
      const attempt = startBotJobProcessor(config, {
        dispatchConcurrency: policy.dispatchConcurrency,
        processJob: (job) => coordinateJob(job, { transport }),
      });
      starting = attempt;
      try {
        await attempt;
      } catch (error) {
        if (starting === attempt && closing === undefined) starting = undefined;
        throw error;
      }
    },
    close() {
      closing ??= closeProcessor();
      return closing;
    },
  };
}
