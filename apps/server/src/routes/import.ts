import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrgRole } from '../auth/plugin.js';
import { devices, groups } from '../db/schema.js';

/**
 * CSV bulk import. Columns: name,host,model,group[,port,protocol]
 * `group` is the group path slug and must already exist.
 */
export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/orgs/:orgId/devices/import',
    {
      preHandler: requireOrgRole('admin'),
      schema: {
        tags: ['devices'],
        params: z.object({ orgId: z.string() }),
        body: z.object({ csv: z.string().max(5 * 1024 * 1024) }),
        response: {
          200: z.object({
            created: z.number(),
            skipped: z.array(z.object({ line: z.number(), reason: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      const orgId = req.params.orgId;
      const orgGroups = await app.db.select().from(groups).where(eq(groups.orgId, orgId));
      const bySlug = new Map(orgGroups.map((g) => [g.pathSlug, g]));

      const lines = req.body.csv.split('\n');
      const skipped: { line: number; reason: string }[] = [];
      let created = 0;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]?.trim();
        if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('name,')) continue;
        const [name, host, model, groupSlug, port, protocol] = raw.split(',').map((s) => s.trim());
        const lineNo = i + 1;
        if (!name || !host || !model || !groupSlug) {
          skipped.push({ line: lineNo, reason: 'missing required column (name,host,model,group)' });
          continue;
        }
        if (!app.registry.get(model)) {
          skipped.push({ line: lineNo, reason: `unknown model: ${model}` });
          continue;
        }
        const group = bySlug.get(groupSlug);
        if (!group) {
          skipped.push({ line: lineNo, reason: `unknown group: ${groupSlug}` });
          continue;
        }
        const [existing] = await app.db
          .select({ id: devices.id })
          .from(devices)
          .where(and(eq(devices.orgId, orgId), eq(devices.name, name)))
          .limit(1);
        if (existing) {
          skipped.push({ line: lineNo, reason: 'device name already exists' });
          continue;
        }
        await app.db.insert(devices).values({
          orgId,
          groupId: group.id,
          name,
          host,
          modelId: model,
          port: port ? Number(port) : null,
          protocol: protocol === 'telnet' ? 'telnet' : 'ssh',
          nextRunAt: new Date(),
        });
        created++;
      }
      return { created, skipped };
    },
  );
};
