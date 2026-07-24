import { errorResponseSchema } from '@fe2o3/shared';
import type { z } from 'zod';

/** Build a response map: 200 → schema, plus declared error status codes. */
export function respond<T extends z.ZodType>(ok: T, ...errorCodes: number[]) {
  const map: Record<number, z.ZodType> = { 200: ok };
  for (const code of errorCodes) map[code] = errorResponseSchema;
  return map;
}

export function httpError(code: number, error: string, message: string) {
  return { statusCode: code, error, message };
}
