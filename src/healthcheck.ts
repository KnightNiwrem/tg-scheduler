import type { Job } from 'bullmq';
import { z } from 'zod';

export const healthcheckDataSchema = z.object({ message: z.string().max(256) });
export type HealthcheckData = z.infer<typeof healthcheckDataSchema>;
export type HealthcheckResult = { status: 'ok'; message: string };

export async function processHealthcheck(
  job: Pick<Job<unknown>, 'name' | 'data'>,
): Promise<HealthcheckResult> {
  if (job.name !== 'healthcheck') {
    throw new Error(`Unsupported bootstrap job: ${job.name}`);
  }
  const { message } = healthcheckDataSchema.parse(job.data);
  return { status: 'ok', message };
}
