import type { SchedulerClientOptions } from './client.ts';
import type { BotPolicy } from './core/coordinator.ts';
import type { BotTokenResolver } from './transport/grammy.ts';
import { UnimplementedError } from './unimplemented-error.ts';

export interface SchedulerWorkerOptions extends SchedulerClientOptions {
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
