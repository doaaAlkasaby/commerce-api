import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { format } from 'prettier';
import { developmentId } from '../../prisma/development/seed.js';
import { discoverRoutes, type Route } from './routes.js';
import {
  completeSchemas,
  loadSchema,
  example,
  inlineBody,
  statuses,
  errors,
  object,
  sampleUuid,
} from './contracts.js';

type Event = { listen: string; script: { type: string; exec: string[] } };
export interface Item {
  name: string;
  request: {
    method: string;
    url: {
      raw: string;
      host: string[];
      path: string[];
      query?: Array<{
        key: string;
        value: string;
        disabled?: boolean;
        description?: string;
      }>;
    };
    header: Array<{ key: string; value: string }>;
    auth: {
      type: string;
      bearer?: Array<{ key: string; value: string; type: string }>;
    };
    description: string;
    body?: {
      mode: string;
      raw?: string;
      options?: unknown;
      formdata?: Array<{
        key: string;
        type: string;
        value?: string;
        src?: string[];
      }>;
    };
  };
  event: Event[];
  response: unknown[];
}
const event = (listen: string, code: string): Event => ({
  listen,
  script: { type: 'text/javascript', exec: code.trim().split('\n') },
});
export const values: Record<string, string> = {
  baseUrl: 'http://localhost:3000',
  apiPrefix: 'api/v1',
  tenantSlug: 'dev81-kuwait-fashion',
  secondTenantSlug: 'dev81-independent',
  activeAccessToken: '',
  mockCheckoutToken: '',
  activeRefreshToken: '',
  customerAccessToken: '',
  customerRefreshToken: '',
  ownerAccessToken: '',
  ownerRefreshToken: '',
  adminAccessToken: '',
  adminRefreshToken: '',
  authProfile: 'customer',
  email: '',
  password: '',
  newPassword: '',
  verificationToken: '',
  resetToken: '',
  deviceToken: '',
  myFatoorahSignature: '',
  webhookEventReference: '',
  providerInvoiceId: '',
  providerTransactionPaymentId: '',
  opsMetricsToken: '',
  userId: developmentId('user:fashion-customer'),
  tenantId: developmentId('tenant:fashion'),
  productId: developmentId('product:fashion:tee'),
  variantId: developmentId('variant:fashion:tee:small'),
  categoryId: developmentId('visual-category:fashion:tee'),
  brandId: developmentId('visual-brand:fashion'),
  warehouseId: developmentId('warehouse:fashion:kuwait'),
  secondWarehouseId: developmentId('warehouse:fashion:saudi'),
  inventoryId: developmentId('inventory:fashion:kuwait:tee:small'),
  shippingAddressId: developmentId('address:fashion-customer:KW'),
  billingAddressId: developmentId('address:fashion-customer:SA'),
  shippingMethodCode: 'local',
  couponCode: 'DEV81SAVE10',
  currency: 'KWD',
  productImageId: developmentId('visual-product:fashion:tee:front'),
  variantImageId: developmentId(
    'visual-variant:' + developmentId('variant:fashion:tee:small'),
  ),
  attributeId: developmentId('attribute:fashion:tee'),
  attributeValueId: developmentId('value:fashion:tee:small'),
  collectionId: developmentId('visual-featured:fashion'),
  bannerId: developmentId('visual-banner:fashion'),
  cartId: '',
  orderId: '',
  paymentId: '',
  couponId: developmentId('coupon:fashion'),
  reviewId: '',
  deviceId: '',
  notificationId: '',
  settingKey: 'features',
  referenceId: '',
  idempotencyKey: '',
  allowMutations: 'false',
  allowPaymentMutations: 'false',
  allowProviderWebhook: 'false',
};
const sensitive = /Token$|password|Password|Signature|opsMetricsToken/;
const fieldVars: Record<string, string> = {
  id: 'userId',
  token: 'verificationToken',
  currentPassword: 'password',
  password: 'password',
  newPassword: 'newPassword',
  email: 'email',
  refreshToken: 'customerRefreshToken',
  valueId: 'attributeValueId',
  key: 'settingKey',
  referenceId: 'referenceId',
  imageUrl: 'seedBannerUrl',
  url: 'seedProductUrl',
};
const notes: Record<string, string> = {
  auth: 'Registration creates a global CUSTOMER identity and returns a user without tokens. Verification/reset delivery may use the private development file outbox. Never log secrets. Set authProfile=customer/owner/admin before login/refresh; each profile has separate tokens. Refresh is single-use: serialize requests and replace the rotated pair.',
  storefront:
    'Enrollment accepts strict {} and grants CUSTOMER membership only. New enrollment 201; existing active membership 200; blocked memberships are not reactivated. Enrollment does not bypass verified-email checkout. Storefront settings use the public whitelist.',
  inventory:
    'Available = quantity - reservedQuantity. Stock belongs to one warehouse. The singular variant lookup uses the active default warehouse. Do not add stock from several warehouses as a whole-cart fulfillment promise. Mutations affect checkout.',
  warehouses:
    'Tenant staff OWNER/ADMIN/MANAGER. Explicit coverage authorizes destination countries; physical warehouse country does not imply cross-border coverage. Reservations/unresolved orders can block changes. Coverage PUT replaces the whole country list. Example Kuwait source; change city/address/coordinates/country for Riyadh deliberately.',
  'order-policy':
    'Amounts are decimal strings in tenant currency. Null removes a limit; omitted PATCH fields stay unchanged. Merchandise limits exclude shipping/tax and apply after discounts. Do not change policies in a normal run.',
  cart: 'Requires active tenant membership. GET may create an empty cart and is therefore guarded. Guest cart is client-local. POST items adds quantity; PATCH sets absolute quantity. Do not blindly retry additive POST after an ambiguous response.',
  checkout:
    'Requires tenant, active membership and verified email. Preview/shipping-options reserve nothing. Final checkout recalculates and reserves one eligible warehouse for the whole cart. Never submit a warehouse selector. All money uses tenant currency. Same key+payload replays (200); new order returns 201. Changed purchase needs a new key. Set idempotencyKey manually with Postman {{$guid}} once, then keep it for retries; no script regenerates it.',
  addresses:
    'Global user-owned addresses; another user’s address is 404. Public field is country, not countryCode. Coordinates are optional but must be a complete pair. Warehouse coverage and shipping rules determine delivery, not browsing country.',
  payments:
    'MyFatoorah Kuwait/KWD sandbox hosted URL is data.metadata.checkoutUrl. NONE supports local COD/bank-transfer recording, not actual transfers/cards. Initiation and verification take strict {}. Verify on backend: browser return is not proof. UNKNOWN requires conservative reconciliation. Order and payment status are independent. Payment mutations require separate explicit opt-in.',
  'payment-providers':
    'Provider-server integration, no customer bearer. Webhook requires MyFatoorah-Signature over the exact provider payload and configured sandbox credentials; payload structure matches PAYMENT_STATUS_CHANGED V2; fill actual sandbox identifiers and signature before explicit use. Callback/error never prove payment success. Never run provider mutations by default.',
  tenants:
    'Tenant-management APIs use the path tenant ID, not X-Tenant-Slug. Create requires global ADMIN (the seeded OWNER user is globally CUSTOMER). Reads require active membership or global ADMIN; writes require tenant OWNER/ADMIN or global ADMIN. Tenant ADMIN cannot change ownership. No privilege elevation scripts.',
  products:
    'Published tenant catalog is public and needs no country header. Currency is selected by tenant, not browsing country. Product variants and images retain their actual relationships. Null media is valid; resolve relative paths against baseUrl, outside apiPrefix.',
};
function moduleName(route: Route) {
  const parts = route.path.split('/').filter(Boolean);
  return parts[0] === '{{apiPrefix}}' ? parts[1]! : parts[0]!;
}
export function access(route: Route) {
  const text = route.middleware.join('\n');
  const roles = [...text.matchAll(/requireTenantRoles\(([^)]+)\)/g)].flatMap(
    (match) =>
      [...match[1]!.matchAll(/['"]([A-Z]+)['"]/g)].map((item) => item[1]!),
  );
  const globalAdmin = /authorize\(/.test(text);
  const management = /tenantManagement/.test(text);
  const auth = /\bauthenticate\b/.test(text);
  return {
    auth,
    tenant: /\btenantMiddleware\b/.test(text),
    member: /\btenantMemberMiddleware\b/.test(text),
    verified: /\brequireVerifiedEmail\b/.test(text),
    roles,
    token: globalAdmin
      ? 'adminAccessToken'
      : roles.length || management
        ? 'ownerAccessToken'
        : 'customerAccessToken',
    management,
    globalAdmin,
  };
}
function variableFor(name: string, route: Route): string {
  if (name !== 'id') return fieldVars[name] ?? name;
  if (route.path.endsWith('/merchant/products/:id')) return 'productId';
  return (
    {
      products: 'productId',
      categories: 'categoryId',
      brands: 'brandId',
      inventory: 'inventoryId',
      warehouses: 'warehouseId',
      addresses: 'shippingAddressId',
      orders: 'orderId',
      payments: 'paymentId',
      coupons: 'couponId',
      'product-images': 'productImageId',
      'product-variant-images': 'variantImageId',
      'product-variants': 'variantId',
      'product-attributes': 'attributeId',
      collections: 'collectionId',
      banners: 'bannerId',
      tenants: 'tenantId',
      users: 'userId',
    }[moduleName(route)] ?? 'userId'
  );
}
function template(value: unknown, route: Route, key = ''): unknown {
  if (Array.isArray(value))
    return value.map((item) =>
      template(item, route, key.replace(/Ids$/, 'Id')),
    );
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        template(item, route, name),
      ]),
    );
  const name = fieldVars[key] ?? key;
  if (
    (/Id$/.test(key) ||
      [
        'email',
        'password',
        'currentPassword',
        'newPassword',
        'token',
        'refreshToken',
        'referenceId',
      ].includes(key)) &&
    name in values
  ) {
    if (key === 'token')
      return `{{${moduleName(route) === 'devices' ? 'deviceToken' : route.path.endsWith('reset-password') ? 'resetToken' : 'verificationToken'}}}`;
    if (key === 'refreshToken') return '{{activeRefreshToken}}';
    return `{{${name}}}`;
  }
  if (['url', 'imageUrl'].includes(key))
    return key === 'url'
      ? '{{baseUrl}}/uploads/development-v82/fashion/tee-front.webp'
      : '{{baseUrl}}/uploads/development-v82/fashion/everyday-edit.webp';
  return value;
}
export async function buildRequest(route: Route): Promise<Item> {
  completeSchemas(route);
  const a = access(route),
    module = moduleName(route),
    success = statuses(route);
  const raw =
    '{{baseUrl}}' +
    route.path.replace(
      /:([A-Za-z0-9_]+)/g,
      (_match, name: string) => `{{${variableFor(name, route)}}}`,
    );
  const headers = a.tenant
    ? [{ key: 'X-Tenant-Slug', value: '{{tenantSlug}}' }]
    : [];
  let token = a.token;
  if (module === 'auth' && a.auth) token = 'activeAccessToken';
  if (route.path === '/ops/metrics') token = 'opsMetricsToken';
  const auth =
    a.auth || route.path === '/ops/metrics'
      ? {
          type: 'bearer',
          bearer: [{ key: 'token', value: `{{${token}}}`, type: 'string' }],
        }
      : { type: 'noauth' };
  const request: Item['request'] = {
    method: route.method,
    url: {
      raw,
      host: ['{{baseUrl}}'],
      path: raw.replace('{{baseUrl}}/', '').split('/'),
    },
    header: headers,
    auth,
    description: '',
  };
  let body: unknown = inlineBody(route),
    bodySchema: z.ZodType | undefined,
    json: Record<string, unknown> | undefined;
  if (route.schemas.body) {
    bodySchema = await loadSchema(route.schemas.body);
    json = z.toJSONSchema(bodySchema, { io: 'input', unrepresentable: 'any' });
    body = example(json, '', route.method === 'PATCH');
  }
  const endpoint = `${route.method} ${route.path.replace('/{{apiPrefix}}', '')}`;
  const mockCheckout = endpoint === 'GET /payments/mock/checkout/:id';
  const mockScenario = endpoint === 'POST /payments/mock/checkout/:id/scenario';
  if (mockScenario) body = { status: 'PAID' };
  if (endpoint === 'POST /products/:productId/reviews')
    body = {
      rating: 5,
      title: 'Development review',
      comment: 'Fits as expected.',
    };
  if (endpoint === 'POST /inventory')
    body = { variantId: sampleUuid, warehouseId: sampleUuid, quantity: 0 };
  if (endpoint === 'PATCH /order-policy')
    body = {
      minOrderAmount: '5',
      maxOrderAmount: '250',
      maxOrderItems: 20,
      maxDistinctItems: 5,
      maxQuantityPerItem: 10,
    };
  if (
    endpoint === 'POST /checkout' ||
    endpoint === 'POST /checkout/preview' ||
    endpoint === 'POST /checkout/shipping-options'
  )
    body = {
      shippingAddressId: sampleUuid,
      billingSameAsShipping: true,
      shippingMethodCode: 'local',
      ...(endpoint === 'POST /checkout'
        ? { paymentMethod: 'CASH_ON_DELIVERY', paymentProvider: 'NONE' }
        : {}),
    };
  if (endpoint === 'POST /warehouses')
    body = {
      code: 'POSTMAN_KUWAIT',
      name: 'Manual Kuwait warehouse',
      countryCode: 'KW',
      city: 'Kuwait City',
      address: 'Development showroom',
      latitude: 29.3759,
      longitude: 47.9774,
      isActive: true,
      isDefault: false,
      priority: 30,
    };
  if (endpoint === 'PATCH /app-settings/:key')
    body = { value: ['warehouse-checkout'] };
  if (endpoint === 'POST /app-settings')
    body = {
      key: 'postman_example',
      value: { enabled: true },
      isPublic: false,
    };
  if (endpoint === 'PATCH /coupons/:id') body = { isActive: true };
  if (bodySchema && !bodySchema.safeParse(body).success)
    throw new Error(
      `Invalid concrete body ${endpoint}: ${bodySchema.safeParse(body).error?.message}`,
    );
  if (body !== undefined) {
    const templated = template(body, route);
    if (route.upload)
      request.body = {
        mode: 'formdata',
        formdata: [
          { key: route.upload, type: 'file', src: [] },
          ...Object.entries(object(templated)).map(([key, value]) => ({
            key,
            type: 'text',
            value: String(value),
          })),
        ],
      };
    else {
      request.header.push({ key: 'Content-Type', value: 'application/json' });
      request.body = {
        mode: 'raw',
        raw: JSON.stringify(templated, null, 2),
        options: { raw: { language: 'json' } },
      };
    }
  } else if (route.upload)
    request.body = {
      mode: 'formdata',
      formdata: [{ key: route.upload, type: 'file', src: [] }],
    };
  let queryJson: Record<string, unknown> | undefined;
  if (route.schemas.query) {
    const schema = await loadSchema(route.schemas.query);
    queryJson = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    const required = Array.isArray(queryJson.required)
      ? queryJson.required
      : [];
    request.url.query = Object.entries(object(queryJson.properties)).map(
      ([key, property]) => ({
        key,
        value: String(template(example(property, key), route, key)),
        disabled:
          !required.includes(key) && object(property).default === undefined,
        description: JSON.stringify(property),
      }),
    );
    // Public mobile home is the default runnable example.
    if (module === 'home')
      request.url.query = [{ key: 'platform', value: 'mobile' }];
    const active = request.url.query
      .filter((item) => !item.disabled)
      .map((item) => `${item.key}=${item.value}`)
      .join('&');
    if (active) request.url.raw += '?' + active;
  }
  if (mockCheckout || mockScenario) {
    request.url.query = [{ key: 'token', value: '{{mockCheckoutToken}}' }];
    request.url.raw += '?token={{mockCheckoutToken}}';
  }
  if (endpoint === 'POST /checkout')
    request.header.push({
      key: 'Idempotency-Key',
      value: '{{idempotencyKey}}',
    });
  if (module === 'payment-providers' && route.method === 'POST')
    request.header.push({
      key: 'MyFatoorah-Signature',
      value: '{{myFatoorahSignature}}',
    });
  const mutates =
    !['GET', 'HEAD', 'OPTIONS'].includes(route.method) ||
    route.path.endsWith('/auth/verify-email') ||
    module === 'cart';
  const payment =
    (module === 'payments' && mutates) ||
    (module === 'checkout' && endpoint === 'POST /checkout');
  const prerequest = `
if (${mutates} && pm.variables.get('allowMutations') !== 'true') pm.execution.skipRequest();
if (${payment} && pm.variables.get('allowPaymentMutations') !== 'true') pm.execution.skipRequest();
if (${module === 'payment-providers' && route.method === 'POST'} && pm.variables.get('allowProviderWebhook') !== 'true') pm.execution.skipRequest();
${
  module === 'auth'
    ? `const profile = pm.variables.get('authProfile');
if (!['customer','owner','admin'].includes(profile)) throw new Error('Select authProfile customer/owner/admin');
pm.variables.set('activeRefreshToken', pm.environment.get(profile+'RefreshToken') || '');
pm.variables.set('activeAccessToken', pm.environment.get(profile+'AccessToken') || '');`
    : ''
}
${mockCheckout || mockScenario ? `if (!pm.variables.get('mockCheckoutToken')) pm.execution.skipRequest();` : ''}
${a.auth || route.path === '/ops/metrics' ? `if (!pm.variables.get('${token}')) pm.execution.skipRequest();` : ''}
${endpoint === 'POST /checkout' ? `if (!pm.variables.get('idempotencyKey')) throw new Error('Set a new idempotencyKey once for this purchase; keep it for retries');` : ''}
`;
  let post = `pm.test('Expected successful status', () => pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify(success)}));`;
  if (mockCheckout)
    post += `
pm.test('Mock checkout HTML', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('text/html'));`;
  else if (!route.path.startsWith('/ops/'))
    post += `
pm.test('Success envelope', () => { const body=pm.response.json(); pm.expect(body.success).to.eql(true); ${endpoint.includes('/merchant/products') ? '' : "pm.expect(body).to.have.property('message');"} pm.expect(body).to.have.property('data'); });`;
  if (route.method === 'POST' && /\/auth\/(login|refresh)$/.test(route.path))
    post += `
if (pm.response.code === 200) {
 const data=pm.response.json().data, profile=pm.variables.get('authProfile');
 if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') throw new Error('Missing rotated token pair');
 pm.environment.set(profile+'AccessToken', data.accessToken);
 pm.environment.set(profile+'RefreshToken', data.refreshToken);
 if(profile==='customer' && data.user) pm.environment.set('userId',data.user.id);
}`;
  if (route.method === 'POST' && route.path.endsWith('/auth/logout'))
    post += `\nif(pm.response.code===200){const profile=pm.variables.get('authProfile');pm.environment.unset(profile+'RefreshToken');pm.environment.unset(profile+'AccessToken');}`;
  if (endpoint === 'POST /checkout')
    post += `
if ([200,201].includes(pm.response.code)) {
 const data=pm.response.json().data;
 pm.expect(data.order).to.have.property('id'); pm.expect(data.payment).to.have.property('id');
 pm.expect(data.order.warehouseId).to.be.a('string');
 pm.environment.set('orderId',data.order.id);pm.environment.set('paymentId',data.payment.id);
}`;
  if (endpoint === 'GET /storefront')
    post += `
if(pm.response.code===200){const data=pm.response.json().data;pm.expect(data.currency).to.match(/^[A-Z]{3}$/);pm.environment.set('currency',data.currency);}`;
  if (route.path.endsWith('/checkout/preview'))
    post += `\nif(pm.response.code===200){const d=pm.response.json().data;pm.expect(d.currency).to.eql(pm.variables.get('currency'));pm.expect(d.fulfillment.warehouseId).to.be.a('string');pm.expect(d.totalAmount).to.be.a('string');}`;
  if (route.path.endsWith('/checkout/shipping-options'))
    post += `\nif(pm.response.code===200){const d=pm.response.json().data;pm.expect(d.estimated).to.eql(true);pm.expect(d.options).to.be.an('array');}`;
  // Only unambiguous customer-created IDs are captured; never replace catalog/staff IDs on list reads.
  const capture = {
    'POST /addresses': 'shippingAddressId',
    'GET /cart': 'cartId',
    'POST /auth/register': 'userId',
  }[endpoint];
  if (capture)
    post += `\nif(${JSON.stringify(success)}.includes(pm.response.code)){const d=pm.response.json().data;if(d && d.id)pm.environment.set('${capture}',d.id);}`;
  const details = [
    `${route.method} ${route.path.replace('/{{apiPrefix}}', '')}: ${route.handler.split('.')[0]?.slice(0, 80)}.`,
    `Authentication: ${a.auth ? `Bearer ${token}` : route.path === '/ops/metrics' ? 'Independent OPS_METRICS_TOKEN, not a user JWT' : 'Public; no bearer'}. Tenant header: ${a.tenant ? 'X-Tenant-Slug: {{tenantSlug}}' : 'not required'}. ${a.member ? 'Active tenant membership required.' : ''} ${a.verified ? 'Verified email required.' : ''} ${a.roles.length ? 'Tenant roles: ' + a.roles.join('/') + '.' : ''} ${a.globalAdmin ? 'Global ADMIN required.' : ''} ${a.management ? 'Path tenant access governed by tenantManagement; see tenant folder.' : ''}`,
    `Headers: ${request.header.map((header) => header.key).join(', ') || 'none'}. Path parameters: ${[...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((item) => `${item[1]}={{${variableFor(item[1]!, route)}}}`).join(', ') || 'none'}. Success status: ${success.join(' or ')}.`,
    `Body: ${request.body?.mode ?? 'none'}. ${json ? 'Input JSON schema (required fields and supported optional fields):\n' + JSON.stringify(json, null, 2) : body !== undefined ? 'Use the exact example; no invented tenant/currency selectors.' : ''}`,
    ...(mockCheckout || mockScenario
      ? [
          'Development MOCK mode only. Set the short-lived signed token from the mock checkout URL. Missing or expired token returns 403. The scenario mutation additionally requires a bearer token and the mutation opt-ins.',
        ]
      : []),
    `Query: ${queryJson ? JSON.stringify(queryJson, null, 2) : 'none documented by route validation'}.`,
    `Important module business errors: ${errors(route).join(', ')}. Shared failures include AUTHENTICATION_REQUIRED/INVALID_ACCESS_TOKEN (protected requests), UNAUTHORIZED/TENANT_NOT_FOUND (tenant context), FORBIDDEN (roles), and VALIDATION_ERROR. Business errors retain {success:false,message,code,data:null}.`,
    `Side effects: ${mutates ? 'may modify state; requires allowMutations=true; do not run against existing/production data without explicit intent.' : 'read-only'}. ${payment ? 'Also requires allowPaymentMutations=true.' : ''}`,
    notes[module] ??
      'Use selected tenant and owned resource identifiers. Refer to source validation and response mappers; no response sample was fabricated.',
    `Source: ${path.relative(process.cwd(), route.file)}. Schema references: ${
      Object.entries(route.schemas)
        .map(
          ([location, ref]) =>
            `${location}: ${path.relative(process.cwd(), ref.file)}#${ref.expression}`,
        )
        .join('; ') || 'inline/controller validation; see source'
    }.`,
  ];
  request.description = details.join('\n\n');
  return {
    name: `${route.method} ${route.path.replace('/{{apiPrefix}}', '')}`,
    request,
    event: [event('prerequest', prerequest), event('test', post)],
    response: [],
  };
}
export async function generate() {
  const routes = discoverRoutes(),
    groups = new Map<string, Item[]>(),
    inventory = [];
  const old = JSON.parse(
    fs.readFileSync('postman/commerce-api.postman_collection.json', 'utf8'),
  );
  // Keep the established folder order and names. Add only newly registered modules.
  for (const folder of z.array(z.object({ name: z.string() })).parse(old.item))
    groups.set(folder.name, []);
  for (const route of routes) {
    const item = await buildRequest(route),
      folder = moduleName(route);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(item);
    inventory.push({
      method: route.method,
      path: route.path,
      source: path.relative(process.cwd(), route.file),
      access: access(route),
      statuses: statuses(route),
      schemas: Object.fromEntries(
        Object.entries(route.schemas).map(([location, ref]) => [
          location,
          { ...ref, file: path.relative(process.cwd(), ref.file) },
        ]),
      ),
      requestName: item.name,
    });
  }
  const media: Item[] = [];
  for (const store of ['fashion', 'independent'])
    for (const file of fs
      .readdirSync(`public/seed-media/${store}`)
      .filter((file) => file.endsWith('.webp'))
      .sort()) {
      const route = `/uploads/development-v82/${store}/${file}`;
      media.push({
        name: `GET ${route}`,
        request: {
          method: 'GET',
          url: {
            raw: '{{baseUrl}}' + route,
            host: ['{{baseUrl}}'],
            path: route.slice(1).split('/'),
          },
          header: [],
          auth: { type: 'noauth' },
          description:
            'Public bundled local WebP. Used by product primary/gallery/size images, categories, brand/storefront logos and desktop/mobile banners. No apiPrefix or internet dependency; backend must be reachable. Source: public/seed-media/' +
            store +
            '/' +
            file +
            '.',
        },
        event: [
          event(
            'test',
            `pm.test('Local image is served',()=>{pm.response.to.have.status(200);pm.expect(pm.response.headers.get('Content-Type')).to.match(/^image\\//);});`,
          ),
        ],
        response: [],
      });
    }
  groups.set('local-media', media);
  // Swagger and static mounts are infrastructure, outside the 180 explicit API/ops/provider routes.
  groups.set('documentation', [
    ...['/api/docs/', '/api/docs.json'].map((url) => ({
      name: 'GET ' + url,
      request: {
        method: 'GET',
        url: {
          raw: '{{baseUrl}}' + url,
          host: ['{{baseUrl}}'],
          path: url.slice(1).split('/'),
        },
        header: [],
        auth: { type: 'noauth' },
        description:
          'Existing Swagger infrastructure route. The OpenAPI artifact has its own generator and is not the API inventory source of truth.',
      },
      event: [
        event(
          'test',
          `pm.test('Documentation served',()=>pm.response.to.have.status(200));`,
        ),
      ],
      response: [],
    })),
  ]);
  const collection = {
    info: {
      name: old.info.name,
      description:
        'Canonical source-synchronized collection. Default execution skips all mutations and protected requests without a selected token. See docs/phase8.3-postman-collection.md. Set baseUrl to backend ORIGIN, apiPrefix without slashes. Requires a Postman version supporting pm.execution.skipRequest.',
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: Object.entries(values)
      .filter(([key]) => !sensitive.test(key) && key !== 'email')
      .map(([key, value]) => ({ key, value, type: 'string' })),
    item: [...groups]
      .filter(([, items]) => items.length)
      .map(([name, item]) => ({
        name,
        description:
          notes[name] ??
          'Current registered routes; mutations are guarded and no import triggers requests.',
        item,
      })),
  };
  fs.writeFileSync(
    'postman/commerce-api.postman_collection.json',
    JSON.stringify(collection, null, 2) + '\n',
  );
  const environment = {
    name: 'Commerce API — local development (sanitized)',
    values: Object.entries(values).map(([key, value]) => ({
      key,
      value,
      enabled: true,
      type: sensitive.test(key) ? 'secret' : 'default',
    })),
    _postman_variable_scope: 'environment',
  };
  fs.writeFileSync(
    'postman/commerce-api.local.postman_environment.json',
    JSON.stringify(environment, null, 2) + '\n',
  );
  const independent = {
    ...values,
    tenantSlug: values.secondTenantSlug!,
    secondTenantSlug: values.tenantSlug!,
    currency: 'SAR',
    tenantId: developmentId('tenant:independent'),
    userId: developmentId('user:independent-customer'),
    productId: developmentId('product:independent:tee'),
    variantId: developmentId('variant:independent:tee:small'),
    categoryId: developmentId('visual-category:independent:tee'),
    brandId: developmentId('visual-brand:independent'),
    warehouseId: developmentId('warehouse:independent:saudi'),
    secondWarehouseId: '',
    inventoryId: developmentId('inventory:independent:saudi:tee:small'),
    shippingAddressId: developmentId('address:independent-customer:SA'),
    billingAddressId: developmentId('address:independent-customer:SA'),
    productImageId: developmentId('visual-product:independent:tee:front'),
    variantImageId: developmentId(
      'visual-variant:' + developmentId('variant:independent:tee:small'),
    ),
    attributeId: developmentId('attribute:independent:tee'),
    attributeValueId: developmentId('value:independent:tee:small'),
    collectionId: developmentId('visual-featured:independent'),
    bannerId: developmentId('visual-banner:independent'),
    couponId: developmentId('coupon:independent'),
  };
  fs.writeFileSync(
    'postman/commerce-api.independent.postman_environment.json',
    JSON.stringify(
      {
        ...environment,
        name: 'Commerce API — independent store (sanitized)',
        values: Object.entries(independent).map(([key, value]) => ({
          key,
          value,
          enabled: true,
          type: sensitive.test(key) ? 'secret' : 'default',
        })),
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    'postman/route-inventory.json',
    JSON.stringify(inventory, null, 2) + '\n',
  );
  await Promise.all(
    [
      'postman/commerce-api.postman_collection.json',
      'postman/commerce-api.local.postman_environment.json',
      'postman/commerce-api.independent.postman_environment.json',
      'postman/route-inventory.json',
    ].map(async (file) =>
      fs.writeFileSync(
        file,
        await format(fs.readFileSync(file, 'utf8'), { parser: 'json' }),
      ),
    ),
  );
  console.log(
    `Synchronized ${routes.length} explicit routes, ${media.length} local media requests, 2 documentation requests; ${collection.item.length} folders.`,
  );
  return collection;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await generate();
