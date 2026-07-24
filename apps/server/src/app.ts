import fastifyCookie from '@fastify/cookie';
import fastifySwagger from '@fastify/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';
import type { Db } from './db/index.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
}

export async function buildApp({ config, db }: BuildAppOptions) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(process.stdout.isTTY ? { transport: { target: 'pino-pretty' } } : {}),
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', db);
  app.decorate('config', config);

  await app.register(fastifyCookie);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'fe2o3 API',
        description: 'Network device configuration backup — REST API',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(scalarApiReference, { routePrefix: '/api/docs' });

  await app.register(healthRoutes, { prefix: '/api/v1' });

  return app;
}
