import type { BotPolicy } from './core/coordinator.ts';
import type { SharedBotOptions } from './shared-bot-options.ts';
import type { BotTokenResolver } from './transport/telegram-transport.ts';
import { UnimplementedError } from './unimplemented-error.ts';

export interface SchedulerWorkerOptions extends SharedBotOptions {
  resolveBotToken: BotTokenResolver;
  policy?: BotPolicy;
}

export interface SchedulerWorker {
  /** Start durable job, recurrence, cooldown, and abandoned-attempt activation. */
  start(): Promise<void>;
  /** Stop admission, drain active work, and close owned backend connections. */
  close(): Promise<void>;
}

/** Runtime environment access and process signal handlers stay in executable entry points. */
export function createSchedulerWorker(_options: SchedulerWorkerOptions): SchedulerWorker {
  return {
    async start() {
      throw new UnimplementedError('SchedulerWorker.start');
    },
    async close() {
      throw new UnimplementedError('SchedulerWorker.close');
    },
  };
}
