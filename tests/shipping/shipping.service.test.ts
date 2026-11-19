import { describe, expect, it } from 'vitest';
import { ShippingService } from '../../src/common/shipping/shipping.service.js';
import type { ShippingRepository } from '../../src/common/shipping/shipping.repository.js';

describe('ShippingService Distance Limit Unit Tests', () => {
  const mockRepo = {
    findProfile: async (tenantId: string, countryCode: string) => {
      if (countryCode !== 'KW') return null;
      return {
        id: 'profile-1',
        tenantId,
        countryCode: 'KW',
        currency: 'KWD',
        originLatitude: '29.3759',
        originLongitude: '47.9774',
        isActive: true,
        zones: [
          {
            id: 'zone-1',
            profileId: 'profile-1',
            code: 'DEFAULT',
            countryCode: 'KW',
            regionCode: null,
            city: null,
            isActive: true,
            methods: [
              {
                id: 'method-1',
                zoneId: 'zone-1',
                code: 'local',
                name: 'Local delivery',
                isActive: true,
                sortOrder: 0,
                rules: [
                  {
                    id: 'rule-1',
                    methodId: 'method-1',
                    isActive: true,
                    minOrderAmount: null,
                    maxOrderAmount: null,
                    maxDistanceKm: '50',
                    rateType: 'FLAT',
                    flatRate: '1.250',
                    priority: 0,
                  },
                ],
              },
            ],
          },
        ],
      };
    },
  } as unknown as ShippingRepository;

  const service = new ShippingService(mockRepo);

  it('1. Throws DELIVERY_COORDINATES_REQUIRED when destination coordinates are missing for distance-limited rule', async () => {
    await expect(
      service.calculate({
        tenantId: 'tenant-1',
        scopeKey: 'GLOBAL',
        currency: 'KWD',
        orderSubtotalCents: 25000n,
        destination: {
          countryCode: 'KW',
          latitude: null,
          longitude: null,
        },
      }),
    ).rejects.toThrow(
      'Delivery address coordinates are required to calculate delivery distance.',
    );
  });

  it('2. Calculates shipping successfully when coordinates are valid and within maxDistanceKm limit', async () => {
    const result = await service.calculate({
      tenantId: 'tenant-1',
      scopeKey: 'GLOBAL',
      currency: 'KWD',
      orderSubtotalCents: 25000n,
      destination: {
        countryCode: 'KW',
        latitude: 29.3759,
        longitude: 47.9774,
      },
    });

    expect(result.shippingMethodCode).toBe('local');
    expect(result.amountCents).toBe(1250n);
  });

  it('3. Throws SHIPPING_NOT_AVAILABLE when destination coordinates exceed maxDistanceKm limit', async () => {
    await expect(
      service.calculate({
        tenantId: 'tenant-1',
        scopeKey: 'GLOBAL',
        currency: 'KWD',
        orderSubtotalCents: 25000n,
        destination: {
          countryCode: 'KW',
          latitude: 32.0000,
          longitude: 50.0000,
        },
      }),
    ).rejects.toThrow(
      'No shipping option is available for this order and destination.',
    );
  });
});
