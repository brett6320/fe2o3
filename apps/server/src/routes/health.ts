import { healthResponseSchema } from '@fe2o3/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      version: '0.1.0',
      uptime: process.uptime(),
    }),
  );
};
