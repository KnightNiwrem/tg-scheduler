import { UnimplementedError } from '../unimplemented-error.ts';
import type { BotTokenResolver, TelegramTransport } from './telegram-transport.ts';

/** grammY implementation of the transport; it adds no automatic retry layer. */
export function createGrammyTransport(
  _botId: string,
  _resolveBotToken: BotTokenResolver,
): TelegramTransport {
  return {
    async attempt(_method, _payload) {
      throw new UnimplementedError('TelegramTransport.attempt');
    },
  };
}
