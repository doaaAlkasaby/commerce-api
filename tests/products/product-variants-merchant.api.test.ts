import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';
import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Phase 2D.4 — Product Attributes, Variants & Default SKU API', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const countryCode = `V${tenantA.id.slice(-7)}`.toUpperCase();

  let adminAId: string;
  let adminAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let adminBId: string;
  let adminBToken: string;
  let categoryAId: string;
  let categoryBId: string;
  let warehouseAId: string;
  let addressAId: string;

  const asAdminA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${adminAToken}`);
  const asCustomerA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerAToken}`);
  const asAdminB = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${adminBToken}`);

  beforeAll(async () => {
    await testPrisma.$connect();
    await tenantA.create();
    await tenantB.create();

    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: 'Variant test country',
        currencyCode: 'USD',
      },
    });

    const [catA, catB] = await Promise.all([
      testPrisma.category.create({
        data: {
          tenantId: tenantA.id,
          name: `Var Cat A ${runId}`,
          slug: `var-cat-a-${runId}`,
        },
      }),
      testPrisma.category.create({
        data: {
          tenantId: tenantB.id,
          name: `Var Cat B ${runId}`,
          slug: `var-cat-b-${runId}`,
        },
      }),
    ]);
    categoryAId = catA.id;
    categoryBId = catB.id;

    const [adminA, customerA, adminB] = await Promise.all([
      testPrisma.user.create({
        data: {
          email: `var-admin-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Admin',
          lastName: 'A',
          role: 'ADMIN',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `var-cust-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Customer',
          lastName: 'A',
          role: 'CUSTOMER',
          emailVerifiedAt: new Date(),
        },
      }),
      testPrisma.user.create({
        data: {
          email: `var-admin-b-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Admin',
          lastName: 'B',
          role: 'ADMIN',
        },
      }),
    ]);
    adminAId = adminA.id;
    customerAId = customerA.id;
    adminBId = adminB.id;

    [adminAToken, customerAToken, adminBToken] = await Promise.all([
      createAccessToken(adminA.id),
      createAccessToken(customerA.id),
      createAccessToken(adminB.id),
    ]);

    await Promise.all([
      testPrisma.tenantMember.create({
        data: { tenantId: tenantA.id, userId: adminA.id, role: 'OWNER' },
      }),
      testPrisma.tenantMember.create({
        data: { tenantId: tenantA.id, userId: customerA.id, role: 'CUSTOMER' },
      }),
      testPrisma.tenantMember.create({
        data: { tenantId: tenantB.id, userId: adminB.id, role: 'ADMIN' },
      }),
    ]);

    const warehouse = await fixtureWarehouse(tenantA.id);
    warehouseAId = warehouse.id;

    // Tax & shipping profile for checkout compatibility test
    const taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId: tenantA.id, code: 'STANDARD', name: 'Standard' },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId: tenantA.id,
        countryCode,
        currency: 'USD',
        defaultTaxCategoryId: taxCategory.id,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: 0 },
    });
    const shippingProfile = await createShippingProfileFixture({
      data: { tenantId: tenantA.id, countryCode, currency: 'USD' },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: shippingProfile.id,
        code: `zone-${runId}`,
        name: 'Default Zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'standard', name: 'Standard' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 0 },
    });

    const address = await testPrisma.address.create({
      data: {
        userId: customerA.id,
        label: 'Home',
        firstName: 'Customer',
        lastName: 'A',
        phone: '+12025550100',
        addressLine1: '100 Main St',
        city: 'City',
        countryCode,
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
    addressAId = address.id;
  });

  afterAll(async () => {
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: tenantA.id } },
    });
    await testPrisma.order.deleteMany({ where: { tenantId: tenantA.id } });
    await testPrisma.cart.deleteMany({ where: { tenantId: tenantA.id } });
    await testPrisma.taxProfile.deleteMany({ where: { tenantId: tenantA.id } });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: tenantA.id } },
    });
    await testPrisma.taxCategory.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await testPrisma.address.deleteMany({ where: { id: addressAId } });
    await tenantA.cleanup();
    await tenantB.cleanup();
    await testPrisma.user.deleteMany({
      where: { id: { in: [adminAId, customerAId, adminBId].filter(Boolean) } },
    });
    await testPrisma.country.deleteMany({ where: { code: countryCode } });
    await testPrisma.$disconnect();
  });

  it('manages simple product default SKU invariants, pricing, activation, Flutter quick-add, and checkout', async () => {
    // Create draft product
    const draft = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Simple Leather Pouch',
          slug: `simple-pouch-${runId}`,
          categoryId: categoryAId,
          basePrice: '40.00',
          discount: { type: 'PERCENTAGE', value: '10' },
        }),
    ).expect(201);
    const productId = draft.body.data.id as string;

    // Customer role cannot create default SKU
    await asCustomerA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({ productId, sku: `CUST-BLOCK-${runId}` }),
    ).expect(403);

    // Create inactive default SKU inheriting basePrice (price: null)
    const defaultSku = `SIMPLE-POUCH-${runId}`;
    const createdDefault = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({
          productId,
          sku: defaultSku,
          price: null,
          isActive: false,
        }),
    ).expect(201);
    const variantId = createdDefault.body.data.id as string;
    expect(createdDefault.body.data).toMatchObject({
      id: variantId,
      productId,
      sku: defaultSku,
      price: null,
      isActive: false,
      isDefault: true,
      attributes: [],
      effectivePrice: {
        basePrice: '40.00',
        finalPrice: '36.00',
      },
    });

    // Second default SKU is rejected
    const secondDefault = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({ productId, sku: `SIMPLE-POUCH-2-${runId}` }),
    ).expect(409);
    expect(secondDefault.body.code).toBe('DEFAULT_VARIANT_ALREADY_EXISTS');

    // Simple product rejects adding attributes
    const addAttrBlocked = await asAdminA(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId, name: 'Color' }),
    ).expect(409);
    expect(addAttrBlocked.body.code).toBe('SIMPLE_PRODUCT_HAS_DEFAULT_VARIANT');

    // Cannot attach attribute values to optionless default SKU via PATCH
    const patchOptionsBlocked = await asAdminA(
      request(app)
        .patch(`/api/v1/product-variants/${variantId}`)
        .send({ attributeValueIds: ['11111111-1111-4111-8111-111111111111'] }),
    ).expect(409);
    expect(patchOptionsBlocked.body.code).toBe(
      'DEFAULT_VARIANT_OPTIONS_IMMUTABLE',
    );

    // Inactive default SKU still blocks product activation
    const activateBlocked = await asAdminA(
      request(app)
        .patch(`/api/v1/products/${productId}/status`)
        .send({ status: 'ACTIVE' }),
    ).expect(409);
    expect(activateBlocked.body.code).toBe('PRODUCT_REQUIRES_ACTIVE_VARIANT');

    // Activate default SKU with variant price override + discount, preserving variant ID and isDefault
    const updatedDefault = await asAdminA(
      request(app)
        .patch(`/api/v1/product-variants/${variantId}`)
        .send({
          price: '50.00',
          discount: { type: 'FIXED_AMOUNT', value: '5.00' },
          isActive: true,
        }),
    ).expect(200);
    expect(updatedDefault.body.data).toMatchObject({
      id: variantId,
      sku: defaultSku,
      price: '50',
      isActive: true,
      isDefault: true,
      effectivePrice: {
        basePrice: '50.00',
        finalPrice: '45.00',
      },
    });

    // Clear override back to null -> inherits product basePrice + product 10% discount (36.00)
    const inherited = await asAdminA(
      request(app)
        .patch(`/api/v1/product-variants/${variantId}`)
        .send({ price: null, discount: null }),
    ).expect(200);
    expect(inherited.body.data).toMatchObject({
      id: variantId,
      price: null,
      isDefault: true,
      effectivePrice: {
        basePrice: '40.00',
        finalPrice: '36.00',
      },
    });

    // Activation now succeeds
    await asAdminA(
      request(app)
        .patch(`/api/v1/products/${productId}/status`)
        .send({ status: 'ACTIVE' }),
    ).expect(200);

    // Storefront listing exposes Flutter quick-add fields: hasVariants=false, defaultVariantId=variantId
    const publicList = await request(app)
      .get('/api/v1/products')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('X-Country-Code', countryCode)
      .query({ categoryId: categoryAId })
      .expect(200);
    const listed = publicList.body.data.items.find(
      (item: { id: string }) => item.id === productId,
    );
    expect(listed).toMatchObject({
      id: productId,
      hasVariants: false,
      defaultVariantId: variantId,
      displayPricing: { originalPrice: '40.00', finalPrice: '36.00' },
    });

    // Add inventory in test DB and verify customer cart + COD checkout compatibility
    await testPrisma.inventory.create({
      data: {
        tenantId: tenantA.id,
        warehouseId: warehouseAId,
        variantId,
        quantity: 5,
        reservedQuantity: 0,
      },
    });

    const cartRes = await asCustomerA(
      request(app)
        .post('/api/v1/cart/items')
        .set('X-Country-Code', countryCode)
        .send({ variantId, quantity: 2 }),
    ).expect(200);
    expect(cartRes.body.data.items).toHaveLength(1);
    expect(cartRes.body.data.items[0].variantId).toBe(variantId);

    const checkoutRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('X-Country-Code', countryCode)
        .set('Idempotency-Key', `simple-checkout-${runId}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode: 'standard',
          paymentMethod: 'CASH_ON_DELIVERY',
        }),
    ).expect(201);
    expect(checkoutRes.body.data.order.items[0]).toMatchObject({
      productId,
      variantId,
      sku: defaultSku,
      quantity: 2,
      variantSnapshot: expect.objectContaining({
        variantId,
        sku: defaultSku,
        values: [],
      }),
    });
  });

  it('manages variable product attributes, values, combinations, duplicates, cross-tenant rejection, and neutral SKU errors', async () => {
    const productA = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Variable Linen Shirt',
          slug: `var-shirt-${runId}`,
          categoryId: categoryAId,
          basePrice: '25.00',
        }),
    ).expect(201);
    const productAId = productA.body.data.id as string;

    const productB = await asAdminB(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Tenant B Product',
          slug: `tenant-b-prod-${runId}`,
          categoryId: categoryBId,
          basePrice: '30.00',
        }),
    ).expect(201);
    const productBId = productB.body.data.id as string;

    // Create attributes with sortOrder, then update name and order
    const colorAttr = await asAdminA(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId: productAId, name: 'Colour', sortOrder: 2 }),
    ).expect(201);
    const colorAttrId = colorAttr.body.data.id as string;

    const sizeAttr = await asAdminA(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId: productAId, name: 'Size', sortOrder: 1 }),
    ).expect(201);
    const sizeAttrId = sizeAttr.body.data.id as string;

    // Product with attributes cannot create optionless default SKU
    const defaultBlocked = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({ productId: productAId, sku: `BLOCK-DEF-${runId}` }),
    ).expect(409);
    expect(defaultBlocked.body.code).toBe('PRODUCT_HAS_ATTRIBUTES');

    // Rename & reorder Colour -> Color (sortOrder: 0)
    await asAdminA(
      request(app)
        .patch(`/api/v1/product-attributes/${colorAttrId}`)
        .send({ name: 'Color', sortOrder: 0 }),
    ).expect(200);

    // Create and reorder attribute values
    const whiteVal = await asAdminA(
      request(app)
        .post(`/api/v1/product-attributes/${colorAttrId}/values`)
        .send({ value: 'Off White', sortOrder: 1 }),
    ).expect(201);
    const whiteValId = whiteVal.body.data.id as string;
    await asAdminA(
      request(app)
        .patch(`/api/v1/product-attributes/values/${whiteValId}`)
        .send({ value: 'White', sortOrder: 0 }),
    ).expect(200);

    const navyVal = await asAdminA(
      request(app)
        .post(`/api/v1/product-attributes/${colorAttrId}/values`)
        .send({ value: 'Navy', sortOrder: 1 }),
    ).expect(201);
    const navyValId = navyVal.body.data.id as string;

    const mediumVal = await asAdminA(
      request(app)
        .post(`/api/v1/product-attributes/${sizeAttrId}/values`)
        .send({ value: 'M', sortOrder: 0 }),
    ).expect(201);
    const mediumValId = mediumVal.body.data.id as string;

    // Empty attributeValueIds rejected on optioned variant endpoint
    await asAdminA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: productAId,
          sku: `EMPTY-ATTR-${runId}`,
          attributeValueIds: [],
        }),
    ).expect(400);

    // Two values from the same attribute rejected
    const sameAttr = await asAdminA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: productAId,
          sku: `SAME-ATTR-${runId}`,
          attributeValueIds: [whiteValId, navyValId],
        }),
    ).expect(400);
    expect(sameAttr.body.code).toBe('MULTIPLE_VALUES_SAME_ATTRIBUTE');

    // Valid optioned variant created with isDefault=false
    const sku1 = `VAR-SHIRT-WHT-M-${runId}`;
    const v1 = await asAdminA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: productAId,
          sku: sku1,
          price: '28.00',
          isActive: true,
          attributeValueIds: [whiteValId, mediumValId],
        }),
    ).expect(201);
    const v1Id = v1.body.data.id as string;
    expect(v1.body.data).toMatchObject({
      id: v1Id,
      sku: sku1,
      price: '28',
      isActive: true,
      isDefault: false,
    });

    // Duplicate combination rejected regardless of ID ordering
    const dupCombo = await asAdminA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: productAId,
          sku: `VAR-SHIRT-DUP-COMBO-${runId}`,
          attributeValueIds: [mediumValId, whiteValId],
        }),
    ).expect(409);
    expect(dupCombo.body.code).toBe('DUPLICATE_VARIANT_COMBINATION');

    // Same-tenant duplicate SKU rejected with neutral message
    const dupSkuOwn = await asAdminA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: productAId,
          sku: sku1,
          attributeValueIds: [navyValId, mediumValId],
        }),
    ).expect(409);
    expect(dupSkuOwn.body.code).toBe('DUPLICATE_VARIANT_SKU');
    expect(dupSkuOwn.body.message).toBe('This SKU is already in use');

    // Cross-tenant SKU collision returns the exact same neutral code & message (zero leakage)
    const dupSkuCrossTenant = await asAdminB(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({ productId: productBId, sku: sku1 }),
    ).expect(409);
    expect(dupSkuCrossTenant.body.code).toBe('DUPLICATE_VARIANT_SKU');
    expect(dupSkuCrossTenant.body.message).toBe('This SKU is already in use');

    // Cross-tenant access rejections
    await asAdminB(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId: productAId, name: 'Foreign' }),
    ).expect(404);
    await asAdminB(
      request(app)
        .patch(`/api/v1/product-attributes/${colorAttrId}`)
        .send({ name: 'Hijacked' }),
    ).expect(404);
    await asAdminB(
      request(app)
        .patch(`/api/v1/product-attributes/values/${whiteValId}`)
        .send({ value: 'Hijacked' }),
    ).expect(404);
    await asAdminB(
      request(app)
        .patch(`/api/v1/product-variants/${v1Id}`)
        .send({ price: '1.00' }),
    ).expect(404);
    const foreignValRes = await asAdminB(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: productBId,
          sku: `FOREIGN-VAL-${runId}`,
          attributeValueIds: [whiteValId],
        }),
    ).expect(400);
    expect(foreignValRes.body.code).toBe('INVALID_ATTRIBUTE_VALUES');

    // Activate variable product and verify Flutter selector contract (hasVariants=true, defaultVariantId=null)
    await asAdminA(
      request(app)
        .patch(`/api/v1/products/${productAId}/status`)
        .send({ status: 'ACTIVE' }),
    ).expect(200);

    const publicList = await request(app)
      .get('/api/v1/products')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('X-Country-Code', countryCode)
      .query({ categoryId: categoryAId })
      .expect(200);
    const listedVar = publicList.body.data.items.find(
      (item: { id: string }) => item.id === productAId,
    );
    expect(listedVar).toMatchObject({
      id: productAId,
      hasVariants: true,
      defaultVariantId: null,
    });

    // Merchant detail includes attribute & value sortOrder
    const merchantDetail = await asAdminA(
      request(app).get(`/api/v1/merchant/products/${productAId}`),
    ).expect(200);
    expect(merchantDetail.body.data.attributes).toEqual([
      {
        id: colorAttrId,
        name: 'Color',
        sortOrder: 0,
        values: [
          { id: whiteValId, value: 'White', sortOrder: 0, imageUrl: null },
          { id: navyValId, value: 'Navy', sortOrder: 1, imageUrl: null },
        ],
      },
      {
        id: sizeAttrId,
        name: 'Size',
        sortOrder: 1,
        values: [{ id: mediumValId, value: 'M', sortOrder: 0, imageUrl: null }],
      },
    ]);
  });
});
