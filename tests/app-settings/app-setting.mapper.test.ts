import { describe, expect, it } from 'vitest';
import { mapPublicSettings } from '../../src/modules/app-settings/app-setting.mapper.js';
import type { AppSetting } from '../../src/generated/prisma/client.js';

describe('AppSetting Mapper Unit Tests', () => {
  it('1. Preserves existing 6 fields and safely defaults when empty', () => {
    const result = mapPublicSettings([]);
    expect(result).toEqual({
      specialOrders: { enabled: false, instructionsAr: null, instructionsEn: null },
      showSimilarProducts: true,
      showComplementaryProducts: true,
      showCartRecommendations: true,
      android_build: [],
      ios_build: [],
      forceUpdate: false,
      currency_ar: '',
      currency_en: '',
      features: [],
    });
  });

  it('2. Maps configured public support settings into optional response fields', () => {
    const mockSettings: AppSetting[] = [
      {
        id: '1',
        tenantId: 'tenant-1',
        key: 'support_email',
        value: 'support@luma.com',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        tenantId: 'tenant-1',
        key: 'support_phone',
        value: '+96521212121',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '3',
        tenantId: 'tenant-1',
        key: 'whatsapp',
        value: '96521212121',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '4',
        tenantId: 'tenant-1',
        key: 'business_hours',
        value: 'Sat-Thu: 9AM - 10PM',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '5',
        tenantId: 'tenant-1',
        key: 'shipping_policy',
        value: 'Standard delivery takes 1-2 days.',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '6',
        tenantId: 'tenant-1',
        key: 'return_policy',
        value: 'Returns accepted within 14 days.',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '7',
        tenantId: 'tenant-1',
        key: 'privacy_policy_url',
        value: 'https://luma.com/privacy',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '8',
        tenantId: 'tenant-1',
        key: 'terms_url',
        value: 'https://luma.com/terms',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '9',
        tenantId: 'tenant-1',
        key: 'faq',
        value: [
          { question: 'How can I track my order?', answer: 'Go to My Orders screen.' },
          { q: 'What payment methods?', a: 'KNET, Credit Card, COD' },
        ],
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = mapPublicSettings(mockSettings);

    expect(result.support_email).toBe('support@luma.com');
    expect(result.support_phone).toBe('+96521212121');
    expect(result.whatsapp).toBe('96521212121');
    expect(result.business_hours).toBe('Sat-Thu: 9AM - 10PM');
    expect(result.shipping_policy).toBe('Standard delivery takes 1-2 days.');
    expect(result.return_policy).toBe('Returns accepted within 14 days.');
    expect(result.privacy_policy_url).toBe('https://luma.com/privacy');
    expect(result.terms_url).toBe('https://luma.com/terms');
    expect(result.faq).toEqual([
      { question: 'How can I track my order?', answer: 'Go to My Orders screen.' },
      { question: 'What payment methods?', answer: 'KNET, Credit Card, COD' },
    ]);
  });

  it('3. Safely omits invalid or non-string/malformed support values without crashing', () => {
    const mockSettings: AppSetting[] = [
      {
        id: '1',
        tenantId: 'tenant-1',
        key: 'support_email',
        value: 12345,
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        tenantId: 'tenant-1',
        key: 'support_phone',
        value: '   ',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '3',
        tenantId: 'tenant-1',
        key: 'faq',
        value: 'not-an-array',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = mapPublicSettings(mockSettings);

    expect(result.support_email).toBeUndefined();
    expect(result.support_phone).toBeUndefined();
    expect(result.faq).toBeUndefined();
  });

  it('4. Rejects non-HTTPS or malformed URLs for policy URLs', () => {
    const mockSettings: AppSetting[] = [
      {
        id: '1',
        tenantId: 'tenant-1',
        key: 'privacy_policy_url',
        value: 'http://insecure.com/privacy',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        tenantId: 'tenant-1',
        key: 'terms_url',
        value: 'not-a-valid-url',
        description: null,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = mapPublicSettings(mockSettings);

    expect(result.privacy_policy_url).toBeUndefined();
    expect(result.terms_url).toBeUndefined();
  });

  it('5. Evaluates show_similar_products strictly and fails closed on malformed or non-public rows', () => {
    const makeRow = (value: unknown, isPublic = true): AppSetting => ({
      id: 'similar-1',
      tenantId: 'tenant-1',
      key: 'show_similar_products',
      value: value as AppSetting['value'],
      description: null,
      isPublic,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(mapPublicSettings([makeRow(true, true)]).showSimilarProducts).toBe(true);
    expect(mapPublicSettings([makeRow(false, true)]).showSimilarProducts).toBe(false);
    expect(mapPublicSettings([makeRow('true', true)]).showSimilarProducts).toBe(false);
    expect(mapPublicSettings([makeRow('false', true)]).showSimilarProducts).toBe(false);
    expect(mapPublicSettings([makeRow(null, true)]).showSimilarProducts).toBe(false);
    expect(
      mapPublicSettings([], {
        showSimilarProductsSetting: { value: false, isPublic: false },
      }).showSimilarProducts,
    ).toBe(false);
    expect(
      mapPublicSettings([], {
        showSimilarProductsSetting: { value: true, isPublic: false },
      }).showSimilarProducts,
    ).toBe(false);
  });

  it('6. Evaluates show_complementary_products independently and fails closed on malformed or non-public rows', () => {
    const makeRow = (
      key: string,
      value: unknown,
      isPublic = true,
    ): AppSetting => ({
      id: `${key}-1`,
      tenantId: 'tenant-1',
      key,
      value: value as AppSetting['value'],
      description: null,
      isPublic,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(
      mapPublicSettings([makeRow('show_complementary_products', true, true)])
        .showComplementaryProducts,
    ).toBe(true);
    expect(
      mapPublicSettings([makeRow('show_complementary_products', false, true)])
        .showComplementaryProducts,
    ).toBe(false);
    expect(
      mapPublicSettings([makeRow('show_complementary_products', 'true', true)])
        .showComplementaryProducts,
    ).toBe(false);
    expect(
      mapPublicSettings([makeRow('show_complementary_products', 'false', true)])
        .showComplementaryProducts,
    ).toBe(false);
    expect(
      mapPublicSettings([makeRow('show_complementary_products', null, true)])
        .showComplementaryProducts,
    ).toBe(false);
    expect(
      mapPublicSettings([], {
        showComplementaryProductsSetting: { value: true, isPublic: false },
      }).showComplementaryProducts,
    ).toBe(false);

    const independent = mapPublicSettings([
      makeRow('show_similar_products', false, true),
      makeRow('show_complementary_products', true, true),
      makeRow('show_cart_recommendations', false, true),
    ]);
    expect(independent.showSimilarProducts).toBe(false);
    expect(independent.showComplementaryProducts).toBe(true);
    expect(independent.showCartRecommendations).toBe(false);
  });

  it('7. Evaluates show_cart_recommendations strictly and fails closed on malformed or non-public rows', () => {
    const makeRow = (value: unknown, isPublic = true): AppSetting => ({
      id: 'cart-rec-1',
      tenantId: 'tenant-1',
      key: 'show_cart_recommendations',
      value: value as AppSetting['value'],
      description: null,
      isPublic,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(mapPublicSettings([makeRow(true, true)]).showCartRecommendations).toBe(true);
    expect(mapPublicSettings([makeRow(false, true)]).showCartRecommendations).toBe(false);
    expect(mapPublicSettings([makeRow('true', true)]).showCartRecommendations).toBe(false);
    expect(mapPublicSettings([makeRow('false', true)]).showCartRecommendations).toBe(false);
    expect(mapPublicSettings([makeRow(1, true)]).showCartRecommendations).toBe(false);
    expect(mapPublicSettings([makeRow(null, true)]).showCartRecommendations).toBe(false);
    expect(
      mapPublicSettings([], {
        showCartRecommendationsSetting: { value: true, isPublic: false },
      }).showCartRecommendations,
    ).toBe(false);
  });
});
