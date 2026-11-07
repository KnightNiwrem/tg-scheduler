import {
  type BotJobProcessor,
  resolveBotBackendConfig,
  startBotJobProcessor,
} from './backend/bullmq.ts';
import { type BotPolicy, coordinateJob, parseBotPolicy } from './core/coordinator.ts';
import { type ErrorHandler, reportErrorToConsole } from './error-handler.ts';
import type { SharedBotOptions } from './shared-bot-options.ts';
import { createGrammyTransport } from './transport/grammy.ts';
import type { BotTokenResolver, TelegramTransport } from './transport/telegram-transport.ts';
import { UnimplementedError } from './unimplemented-error.ts';

export interface SchedulerWorkerOptions extends SharedBotOptions {
  resolveBotToken: BotTokenResolver;
  /** Starting this worker sets the bot's shared ordinary capacity; the latest write wins. */
  policy?: BotPolicy;
  /**
   * Receives backend connection errors and unexpected job processing errors that no operation
   * awaits. Defaults to `console.error`.
   */
  onError?: ErrorHandler;
}

export interface SchedulerWorker {
  /**
   * Configure the bot's shared capacity and start claiming due jobs. Connection behavior follows
   * the supplied client. A failed start may be retried. Recurrence and the urgent lane are not
   * implemented yet.
   */
  start(): Promise<void>;
  /**
   * Stop admission, drain active work, and close BullMQ resources.
   * The caller's connection remains open.
   */
  close(): Promise<void>;
}

/**
 * Construction validates options but performs no I/O. Runtime environment access and process
 * signal handlers stay in executable entry points.
 *
 * @throws {TypeError} when the bot identity, backend options, policy, or token resolver is invalid.
 */
export function createSchedulerWorker(options: SchedulerWorkerOptions): SchedulerWorker {
  if (typeof options.resolveBotToken !== 'function') {
    throw new TypeError('Invalid resolveBotToken: expected a function');
  }
  return createSchedulerWorkerWithTransport(
    options,
    createGrammyTransport(options.botId, options.resolveBotToken),
  );
}

/** Assemble a worker around a given transport, such as a fake Telegram API in tests. */
export function createSchedulerWorkerWithTransport(
  options: Omit<SchedulerWorkerOptions, 'resolveBotToken'>,
  transport: TelegramTransport,
): SchedulerWorker {
  const config = resolveBotBackendConfig(options.botId, options.backend);
  const policy = parseBotPolicy(options.policy);
  const onError = options.onError ?? reportErrorToConsole;
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
      if (policy.urgentBypassEnabled) throw new UnimplementedError('Urgent bypass');
      const attempt = startBotJobProcessor(config, {
        ordinaryConcurrency: policy.ordinaryConcurrency,
        processJob: (job) => coordinateJob(job, { transport }),
        onError,
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
