import { Api, type ApiClientOptions } from 'grammy';
import { expect, test } from 'vitest';
import type { TelegramRequest } from '../src/telegram.ts';
import { createGrammyTransport } from '../src/transport/grammy.ts';

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
  }) as ApiClientOptions['fetch'];
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
) {
  const botApi = fakeBotApi(answer);
  const transport = createGrammyTransport(new Api(token, { fetch: botApi.fetch }));
  return { outcome: await transport.attempt(request), calls: botApi.calls };
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

test('the caller-owned instance is used by reference with its own configuration', async () => {
  const botApi = fakeBotApi(() => telegramResponse({ ok: true, result: true }));
  const api = new Api(token, { apiRoot: 'https://bot-api.example', fetch: botApi.fetch });
  const transformedMethods: string[] = [];
  api.config.use((prev, method, payload, signal) => {
    transformedMethods.push(method);
    return prev(method, payload, signal);
  });
  const installedTransformers = api.config.installedTransformers();

  const outcome = await createGrammyTransport(api).attempt(sendMessage);

  expect(outcome).toEqual({ kind: 'succeeded', result: true });
  expect(botApi.calls.map((call) => call.url)).toEqual([
    `https://bot-api.example/bot${token}/sendMessage`,
  ]);
  expect(transformedMethods).toEqual(['sendMessage']);
  expect(api.config.installedTransformers()).toEqual(installedTransformers);
});

test('a 429 from a separate grammY copy is classified by its fields', async () => {
  const botApi = fakeBotApi(() => telegramResponse({ ok: true, result: true }));
  const api = new Api(token, { fetch: botApi.fetch });
  // Another grammY installation throws an error with the same fields but a different constructor.
  api.config.use(() => {
    throw Object.assign(new Error('Call failed (429: Too Many Requests)'), {
      ok: false,
      error_code: 429,
      description: 'Too Many Requests: retry after 7',
      parameters: { retry_after: 7 },
    });
  });

  const outcome = await createGrammyTransport(api).attempt(sendMessage);

  expect(outcome).toEqual({ kind: 'rate-limited', retryAfterSeconds: 7 });
  expect(botApi.calls).toEqual([]);
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
