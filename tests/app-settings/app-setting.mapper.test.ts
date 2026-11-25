import { describe, expect, it } from 'vitest';
import { mapPublicSettings } from '../../src/modules/app-settings/app-setting.mapper.js';
import type { AppSetting } from '../../src/generated/prisma/client.js';

describe('AppSetting Mapper Unit Tests', () => {
  it('1. Preserves existing 6 fields and safely defaults when empty', () => {
    const result = mapPublicSettings([]);
    expect(result).toEqual({
      specialOrders: { enabled: false, instructionsAr: null, instructionsEn: null },
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
});
