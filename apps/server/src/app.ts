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
import { authPlugin } from './auth/plugin.js';
import type { AppConfig } from './config.js';
import { DriverRegistry } from './core/models/registry.js';
import type { Db } from './db/index.js';
import { EventBus } from './realtime/bus.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { inventoryRoutes } from './routes/inventory.js';
import { mfaRoutes } from './routes/mfa.js';
import { orgRoutes } from './routes/orgs.js';
import { setupRoutes } from './routes/setup.js';
import { userRoutes } from './routes/users.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    registry: DriverRegistry;
    bus: EventBus;
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
  const registry = new DriverRegistry();
  await registry.loadPlugins(config.driversDir);
  app.decorate('registry', registry);
  app.decorate('bus', new EventBus());

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

  await app.register(authPlugin);

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(setupRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(orgRoutes, { prefix: '/api/v1' });
  await app.register(inventoryRoutes, { prefix: '/api/v1' });
  await app.register(deviceRoutes, { prefix: '/api/v1' });
  await app.register(eventRoutes, { prefix: '/api/v1' });
  await app.register(mfaRoutes, { prefix: '/api/v1' });
  await app.register(apiKeyRoutes, { prefix: '/api/v1' });

  return app;
}
