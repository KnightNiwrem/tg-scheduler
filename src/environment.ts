import { z } from 'zod';

const valkeyUrlSchema = z.url({ protocol: /^rediss?$/ }).pipe(
  z.string().refine((value) => {
    const url = new URL(value);
    return (
      url.hostname.length > 0 &&
      url.port !== '0' &&
      /^\/(?:0|[1-9]\d*)?$/.test(url.pathname || '/') &&
      Number.isSafeInteger(Number(url.pathname.slice(1))) &&
      url.search === '' &&
      url.hash === ''
    );
  }, 'Expected a redis:// or rediss:// URL with a host and optional database number; no query or fragment'),
);

export const environmentSchema = z.object({
  VALKEY_URL: valkeyUrlSchema,
  QUEUE_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Use letters, digits, underscores, or hyphens')
    .default('tg-scheduler-bootstrap'),
  WORKER_CONCURRENCY: z
    .string()
    .regex(/^[1-9]\d*$/, 'Expected a positive integer')
    .pipe(z.coerce.number<string>().int().positive())
    .default(1),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(variables: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(variables);
  if (!result.success) {
    // Report field names and constraints without exposing credential-bearing input values.
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n${problems.join('\n')}`);
  }
  return result.data;
}
