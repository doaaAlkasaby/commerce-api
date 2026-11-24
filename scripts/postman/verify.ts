import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { z } from 'zod';
import { discoverRoutes } from './routes.js';
import { access, buildRequest } from './generate.js';
import { completeSchemas, loadSchema, sampleUuid } from './contracts.js';

export const itemSchema = z.object({
  name: z.string(),
  request: z.object({
    method: z.string(),
    url: z.object({
      raw: z.string(),
      query: z
        .array(
          z.object({
            key: z.string(),
            value: z.string(),
            disabled: z.boolean().optional(),
          }),
        )
        .optional(),
    }),
    auth: z.object({
      type: z.string(),
      bearer: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .optional(),
    }),
    header: z.array(z.object({ key: z.string(), value: z.string() })),
    body: z
      .object({
        mode: z.string(),
        raw: z.string().optional(),
        formdata: z
          .array(
            z.object({
              key: z.string(),
              type: z.string(),
              value: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    description: z.string(),
  }),
  event: z.array(
    z.object({
      listen: z.string(),
      script: z.object({ exec: z.array(z.string()) }),
    }),
  ),
  response: z.array(z.unknown()).optional(),
});
export function readCollection(directory = 'postman') {
  return z
    .object({
      info: z.object({ name: z.string() }),
      variable: z.array(z.object({ key: z.string(), value: z.string() })),
      item: z.array(z.object({ name: z.string(), item: z.array(itemSchema) })),
    })
    .parse(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'commerce-api.postman_collection.json'),
          'utf8',
        ),
      ),
    );
}
export function resolveVariables(
  text: string,
  variables: Record<string, string>,
) {
  return text.replace(
    /\{\{([A-Za-z0-9_]+)\}\}/g,
    (_match, key: string) =>
      variables[key] ??
      (() => {
        throw new Error(`Unknown variable ${key}`);
      })(),
  );
}
export async function verify(directory = 'postman') {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(directory, 'commerce-api.postman_collection.json'),
      'utf8',
    ),
  );
  const ajv = new Ajv({ schemaId: 'auto', allErrors: true });
  ajv.addMetaSchema(
    JSON.parse(
      fs.readFileSync(
        'node_modules/ajv/lib/refs/json-schema-draft-04.json',
        'utf8',
      ),
    ),
  );
  if (
    !ajv.validate(
      JSON.parse(
        fs.readFileSync('postman/schema/collection-v2.1.schema.json', 'utf8'),
      ),
      raw,
    )
  )
    throw new Error(JSON.stringify(ajv.errors));
  const collection = readCollection(directory),
    items = collection.item.flatMap((folder) => folder.item),
    routes = discoverRoutes();
  const env = z
    .object({
      values: z.array(z.object({ key: z.string(), value: z.string() })),
    })
    .parse(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'commerce-api.local.postman_environment.json'),
          'utf8',
        ),
      ),
    );
  const variables = Object.fromEntries(
    env.values.map((item) => [item.key, item.value]),
  );
  const samples: Record<string, string> = {
    ...variables,
    email: 'customer@example.test',
    password: 'ExampleOnly!Aa123',
    newPassword: 'ExampleOnly!Bb234',
    verificationToken: 'manual-token',
    resetToken: 'manual-token',
    deviceToken: 'manual-device-token',
    activeRefreshToken: 'manual-refresh-token',
    referenceId: 'manual-reference',
  };
  for (const key of Object.keys(samples))
    if (key.endsWith('Id') && !samples[key])
      Object.assign(samples, { [key]: sampleUuid });
  const duplicates = new Set<string>();
  for (const item of items) {
    const key = `${item.request.method} ${item.request.url.raw}`;
    if (duplicates.has(key)) throw new Error('Duplicate ' + key);
    duplicates.add(key);
    resolveVariables(JSON.stringify(item.request), variables);
    for (const event of item.event)
      new vm.Script(event.script.exec.join('\n'), { filename: item.name });
    if (item.response?.length)
      throw new Error('Review saved response provenance');
  }
  for (const route of routes) {
    const expected = await buildRequest(route),
      item = items.find((item) => item.name === expected.name);
    if (!item) throw new Error(`Missing ${expected.name}`);
    if (JSON.stringify(itemSchema.parse(expected)) !== JSON.stringify(item))
      throw new Error(`Stale generated request ${item.name}`);
    const a = access(route);
    if (
      a.tenant &&
      !item.request.header.some(
        (header) =>
          header.key === 'X-Tenant-Slug' && header.value === '{{tenantSlug}}',
      )
    )
      throw new Error('Missing tenant context ' + item.name);
    if (a.auth && item.request.auth.type !== 'bearer')
      throw new Error('Missing auth ' + item.name);
    if (
      !a.auth &&
      route.path !== '/ops/metrics' &&
      item.request.auth.type !== 'noauth'
    )
      throw new Error('Public request inherits auth ' + item.name);
    completeSchemas(route);
    if (route.schemas.body) {
      const schema = await loadSchema(route.schemas.body);
      let body: unknown;
      if (item.request.body?.mode === 'raw')
        body = JSON.parse(
          resolveVariables(item.request.body.raw ?? '{}', samples),
        );
      else
        body = Object.fromEntries(
          (item.request.body?.formdata ?? [])
            .filter((field) => field.type !== 'file')
            .map((field) => [
              field.key,
              resolveVariables(field.value ?? '', samples),
            ]),
        );
      const result = schema.safeParse(body);
      if (!result.success)
        throw new Error(`${item.name}: ${result.error.message}`);
    }
    if (route.schemas.query) {
      const schema = await loadSchema(route.schemas.query);
      const query = Object.fromEntries(
        (item.request.url.query ?? [])
          .filter((item) => !item.disabled)
          .map((item) => [item.key, resolveVariables(item.value, samples)]),
      );
      const result = schema.safeParse(query);
      if (!result.success)
        throw new Error(`Query ${item.name}: ${result.error.message}`);
    }
    if (route.schemas.params) {
      const schema = await loadSchema(route.schemas.params);
      const template = expected.request.url.raw
        .split('?')[0]!
        .replace('{{baseUrl}}', '')
        .split('/');
      const params: Record<string, string> = {};
      route.path.split('/').forEach((part, index) => {
        if (part.startsWith(':'))
          params[part.slice(1)] = resolveVariables(
            template[index] ?? '',
            samples,
          );
      });
      const result = schema.safeParse(params);
      if (!result.success)
        throw new Error(`Params ${item.name}: ${result.error.message}`);
    }
  }
  for (const folder of collection.item.filter(
    (folder) => folder.name === 'local-media',
  ))
    for (const item of folder.item) {
      const relative = item.request.url.raw.replace(
        '{{baseUrl}}/uploads/development-v82/',
        '',
      );
      if (relative.includes('..')) throw new Error('Unsafe media path');
      const bytes = fs.readFileSync('public/seed-media/' + relative);
      if (bytes.subarray(8, 12).toString() !== 'WEBP')
        throw new Error('Missing actual WebP');
    }
  for (const [key, value] of Object.entries(variables))
    if (/Token$|password|Password|Signature/.test(key) && value)
      throw new Error('Committed credential ' + key);
  console.log(
    `Postman v2.1 schema, source parity, ${routes.length} route contracts, ${items.length} unique requests, variables, scripts, local assets and sanitized credentials: PASS.`,
  );
  return { routes: routes.length, requests: items.length };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await verify();
