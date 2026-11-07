import { expect, test } from 'vitest';
import type { TelegramRequest } from '../src/telegram.ts';
import { createGrammyTransport, type GrammyTransportOptions } from '../src/transport/grammy.ts';
import type { BotTokenResolver } from '../src/transport/telegram-transport.ts';

const botId = '123456';
const token = '123456:secret-token';

interface FetchCall {
  url: string;
  body: unknown;
}

/** Fake Bot API: records each HTTP call and answers with the given response or failure. */
function fakeBotApi(answer: () => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return answer();
  }) as GrammyTransportOptions['fetch'];
  return { calls, fetch };
}

function telegramResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const sendMessage: TelegramRequest = {
  method: 'sendMessage',
  payload: { chat_id: 1, text: 'hello' },
};

async function attemptWith(
  answer: () => Response | Promise<Response>,
  request: TelegramRequest = sendMessage,
  resolveBotToken: BotTokenResolver = () => token,
) {
  const api = fakeBotApi(answer);
  const transport = createGrammyTransport(botId, resolveBotToken, { fetch: api.fetch });
  return { outcome: await transport.attempt(request), calls: api.calls };
}

test('a successful call sends one request and returns the Telegram result', async () => {
  const { outcome, calls } = await attemptWith(() =>
    telegramResponse({ ok: true, result: { message_id: 7 } }),
  );
  expect(outcome).toEqual({ kind: 'succeeded', result: { message_id: 7 } });
  expect(calls).toEqual([
    { url: `https://api.telegram.org/bot${token}/sendMessage`, body: sendMessage.payload },
  ]);
});

test('a zero-parameter method is called with an empty payload', async () => {
  const { outcome, calls } = await attemptWith(
    () => telegramResponse({ ok: true, result: { id: 123456, is_bot: true } }),
    { method: 'getMe', payload: {} },
  );
  expect(outcome).toMatchObject({ kind: 'succeeded' });
  expect(calls).toEqual([{ url: `https://api.telegram.org/bot${token}/getMe`, body: {} }]);
});

test('a Telegram rejection records its API error', async () => {
  const { outcome, calls } = await attemptWith(() =>
    telegramResponse(
      { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
      400,
    ),
  );
  expect(outcome).toEqual({
    kind: 'failed',
    error: { message: 'Bad Request: chat not found', telegramErrorCode: 400 },
  });
  expect(calls).toHaveLength(1);
});

test.each([
  ['a valid retry_after', { retry_after: 5 }, 5],
  ['an invalid retry_after', { retry_after: 'soon' }, 'soon'],
  ['no parameters', undefined, undefined],
])(
  'a 429 with %s reports the raw retry delay without retrying',
  async (_case, parameters, retryAfterSeconds) => {
    const { outcome, calls } = await attemptWith(() =>
      telegramResponse(
        { ok: false, error_code: 429, description: 'Too Many Requests', parameters },
        429,
      ),
    );
    expect(outcome).toEqual({ kind: 'rate-limited', retryAfterSeconds });
    expect(calls).toHaveLength(1);
  },
);

test('a Telegram server error fails once with its API error', async () => {
  const { outcome, calls } = await attemptWith(() =>
    telegramResponse({ ok: false, error_code: 502, description: 'Bad Gateway' }, 502),
  );
  expect(outcome).toEqual({
    kind: 'failed',
    error: { message: 'Bad Gateway', telegramErrorCode: 502 },
  });
  expect(calls).toHaveLength(1);
});

test.each([
  ['a network failure', () => Promise.reject(new Error(`request to bot${token} failed`))],
  ['a timeout', () => Promise.reject(new Error('Request timed out'))],
  ['a non-JSON response', () => new Response('<html>proxy error</html>', { status: 502 })],
])('%s fails once and does not expose the token', async (_case, answer) => {
  const { outcome, calls } = await attemptWith(answer);
  expect(outcome).toMatchObject({ kind: 'failed', error: { message: expect.any(String) } });
  expect(JSON.stringify(outcome)).not.toContain(token);
  expect(calls).toHaveLength(1);
});

test.each([
  [
    'throws',
    () => {
      throw new Error(`vault lookup failed for ${token}`);
    },
  ],
  ['returns an empty token', () => ''],
])('when the token resolver %s, the call fails without sending', async (_case, resolveBotToken) => {
  const { outcome, calls } = await attemptWith(
    () => telegramResponse({ ok: true, result: true }),
    sendMessage,
    resolveBotToken,
  );
  expect(outcome).toMatchObject({ kind: 'failed' });
  expect(JSON.stringify(outcome)).not.toContain(token);
  expect(calls).toEqual([]);
});

test('the token is resolved for each attempt, so rotation takes effect', async () => {
  const tokens = ['1:first', '1:second'];
  const api = fakeBotApi(() => telegramResponse({ ok: true, result: true }));
  const transport = createGrammyTransport(botId, () => tokens.shift() ?? '', { fetch: api.fetch });
  await transport.attempt(sendMessage);
  await transport.attempt(sendMessage);
  expect(api.calls.map((call) => new URL(call.url).pathname)).toEqual([
    '/bot1:first/sendMessage',
    '/bot1:second/sendMessage',
  ]);
});

test('an unknown method is sent once and its 404 is recorded', async () => {
  const { outcome, calls } = await attemptWith(
    () => telegramResponse({ ok: false, error_code: 404, description: 'Not Found' }, 404),
    // Untyped callers can submit a misspelled method; only its name format is checked.
    { method: 'sendMesage', payload: { chat_id: 1 } } as unknown as TelegramRequest,
  );
  expect(outcome).toEqual({
    kind: 'failed',
    error: { message: 'Not Found', telegramErrorCode: 404 },
  });
  expect(calls.map((call) => new URL(call.url).pathname)).toEqual([`/bot${token}/sendMesage`]);
});
