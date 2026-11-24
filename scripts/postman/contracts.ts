import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import { source, type Route, type SchemaRef } from './routes.js';

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
const ref = (file: string, name: string): SchemaRef => ({
  file: path.resolve(`src/modules/${file}.ts`),
  name,
  expression: name,
});
export function completeSchemas(route: Route) {
  const key = `${route.method} ${route.path.replace('/{{apiPrefix}}', '')}`;
  const extra: Record<string, SchemaRef> = {
    'POST /warehouses': ref(
      'warehouses/warehouse.schemas',
      'createWarehouseSchema',
    ),
    'PATCH /warehouses/:id': ref(
      'warehouses/warehouse.schemas',
      'updateWarehouseSchema',
    ),
    'PATCH /order-policy': ref(
      'warehouses/order-policy.service',
      'orderPolicySchema',
    ),
    'POST /tenants': ref('tenants/tenant.schemas', 'createTenantSchema'),
    'PATCH /tenants/:id': ref('tenants/tenant.schemas', 'updateTenantSchema'),
    'POST /tenants/:id/members': ref(
      'tenants/tenant.schemas',
      'addTenantMemberSchema',
    ),
    'PATCH /tenants/:id/members/:userId': ref(
      'tenants/tenant.schemas',
      'updateTenantMemberSchema',
    ),
    'POST /product-images/upload': ref(
      'product-images/product-image.schemas',
      'uploadProductImageSchema',
    ),
    'POST /product-variant-images/upload': ref(
      'product-variant-images/product-variant-image.schemas',
      'uploadProductVariantImageSchema',
    ),
  };
  if (extra[key]) route.schemas.body = extra[key];
}
export async function loadSchema(ref: SchemaRef): Promise<z.ZodType> {
  if (ref.inline === 'empty-strict-object') return z.strictObject({});
  const module: unknown = await import(pathToFileURL(ref.file).href);
  const candidate = object(module)[ref.name];
  if (!(candidate instanceof z.ZodType))
    throw new Error(`Not a Zod schema: ${ref.file}:${ref.name}`);
  if (ref.expression.includes('.omit(')) {
    if (
      !(candidate instanceof z.ZodObject) ||
      !ref.expression.includes('attributeId')
    )
      throw new Error('Audit unsupported schema expression');
    return candidate.omit({ attributeId: true });
  }
  return candidate;
}
export const sampleUuid = '00000000-0000-4000-a000-000000000001';
export const fields: Record<string, unknown> = {
  email: 'customer@example.test',
  password: 'ExampleOnly!Aa123',
  currentPassword: 'ExampleOnly!Aa123',
  newPassword: 'ExampleOnly!Bb234',
  confirmPassword: 'ExampleOnly!Bb234',
  firstName: 'Development',
  lastName: 'Customer',
  name: 'Development example',
  slug: 'development-example',
  code: 'POSTMAN_EXAMPLE',
  country: 'KW',
  countryCode: 'KW',
  currency: 'KWD',
  defaultCurrency: 'KWD',
  timezone: 'Asia/Kuwait',
  city: 'Kuwait City',
  state: 'Al Asimah',
  address: 'Development showroom',
  addressLine1: 'Development delivery address',
  latitude: 29.3759,
  longitude: 47.9774,
  description: 'Manual development example',
  reason: 'Explicit manual test',
  sku: 'POSTMAN-MANUAL-SKU',
  value: '10',
  basePrice: '12.500',
  price: '12.500',
  amount: '1',
  discountValue: '10',
  subtotal: '12.5',
  storageKey: 'development-v82/fashion/tee-front.webp',
  imageStorageKey: 'development-v82/fashion/everyday-edit.webp',
  url: 'http://backend.example.test/uploads/development-v82/fashion/tee-front.webp',
  imageUrl:
    'http://backend.example.test/uploads/development-v82/fashion/everyday-edit.webp',
  refreshToken: 'MANUAL_REFRESH_TOKEN',
  token: 'MANUAL_TOKEN',
  title: 'Development review',
  comment: 'Fits as expected.',
  quantity: 1,
  rating: 5,
  sortOrder: 0,
  isActive: true,
  isPrimary: true,
  billingSameAsShipping: true,
  referenceId: 'MANUAL_REFERENCE',
};
export function example(schema: unknown, key = '', optional = false): unknown {
  const item = object(schema);
  if (item.default !== undefined) return item.default;
  if (Array.isArray(item.enum)) return item.enum[0];
  if (item.const !== undefined) return item.const;
  if (Array.isArray(item.anyOf))
    return example(
      item.anyOf.find((value) => object(value).type !== 'null'),
      key,
      optional,
    );
  if (fields[key] !== undefined) return fields[key];
  if (/Price$|Amount$/.test(key)) return '10';
  if (item.type === 'object' || item.properties) {
    const result: Record<string, unknown> = {};
    const properties = object(item.properties);
    const required = Array.isArray(item.required) ? item.required : [];
    for (const [name, value] of Object.entries(properties))
      if (
        required.includes(name) ||
        (optional && Object.keys(result).length === 0)
      )
        result[name] = example(value, name);
    return result;
  }
  if (item.type === 'array')
    return [example(item.items, key.replace(/Ids$/, 'Id'))];
  if (item.format === 'uuid' || /Id$/.test(key)) return sampleUuid;
  if (item.type === 'boolean') return true;
  if (item.type === 'number' || item.type === 'integer')
    return Math.max(1, Number(item.minimum ?? 1));
  if (item.type === 'null') return null;
  if (item.format === 'date-time') return '2030-01-01T00:00:00.000Z';
  return 'example';
}
export function inlineBody(route: Route): unknown {
  const p = route.path;
  if (p.endsWith('/storefront/enroll')) return {};
  if (p.endsWith('/coverage')) return { countries: ['KW'] };
  if (/\/(categories|brands)\/:id\/status$/.test(p)) return { isActive: true };
  if (p.endsWith('/payment-providers/myfatoorah/webhook'))
    return {
      Event: {
        Code: 1,
        Name: 'PAYMENT_STATUS_CHANGED',
        CountryIsoCode: 'KWT',
        Reference: '{{webhookEventReference}}',
      },
      Data: {
        Invoice: {
          Id: '{{providerInvoiceId}}',
          Status: 'PENDING',
          ExternalIdentifier: null,
        },
        Transaction: {
          Status: 'AUTHORIZE',
          PaymentId: '{{providerTransactionPaymentId}}',
        },
      },
    };
  return undefined;
}
export function statuses(route: Route): number[] {
  if (
    route.path.endsWith('/storefront/enroll') ||
    (route.method === 'POST' && route.path.endsWith('/checkout'))
  )
    return [200, 201];
  const wrapped = route.handler.match(
    /=>\s*[A-Za-z0-9_]+\.([A-Za-z0-9_]+)\(/,
  )?.[1];
  const method =
    wrapped ??
    route.handler
      .replace(/\.bind\([\s\S]*$/, '')
      .split('.')
      .at(-1);
  let codes: number[] = [];
  function inspect(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'status' &&
      node.expression.expression.getText().startsWith('res')
    ) {
      const value = Number(node.arguments[0]?.getText());
      if (value >= 200 && value < 300) codes.push(value);
    }
    ts.forEachChild(node, inspect);
  }
  if (!wrapped && /^(async|\()/.test(route.handler)) {
    // Inline success handlers in this tree use 200 unless explicitly overridden above.
    return [200];
  }
  for (const file of fs
    .readdirSync(path.dirname(route.file))
    .filter((file) => file.endsWith('.controller.ts'))) {
    const sf = source(path.join(path.dirname(route.file), file));
    function visit(node: ts.Node) {
      if (
        (ts.isMethodDeclaration(node) ||
          ts.isPropertyAssignment(node) ||
          ts.isVariableDeclaration(node) ||
          ts.isFunctionDeclaration(node)) &&
        node.name?.getText(sf) === method
      ) {
        inspect(node);
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  if (!codes.length) codes = [200];
  return [...new Set(codes)];
}
export function errors(route: Route) {
  const result = new Set(['VALIDATION_ERROR']);
  for (const file of fs
    .readdirSync(path.dirname(route.file))
    .filter((file) => /\.(service|repository|controller)\.ts$/.test(file))) {
    const sf = source(path.join(path.dirname(route.file), file));
    function visit(node: ts.Node) {
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(sf) === 'AppError'
      ) {
        const arg = node.arguments?.[2];
        if (arg && ts.isStringLiteralLike(arg)) result.add(arg.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  return [...result].sort();
}
