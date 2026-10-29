import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/common/errors/app-error.js';
import { calculateDistanceKm } from '../../src/common/shipping/shipping.calculator.js';
import { ShippingService } from '../../src/common/shipping/shipping.service.js';
import type { ShippingRepository } from '../../src/common/shipping/shipping.repository.js';

const baseRule = { id: 'rule', flatRate: 3, maxDistanceKm: 5 };

function serviceFor(maxDistanceKm: number | null = 5) {
  const repository = {
    findProfile: async () => ({
      currency: 'USD',
      originLatitude: 0,
      originLongitude: 0,
      zones: [
        {
          countryCode: 'US',
          regionCode: null,
          city: null,
          methods: [
            {
              id: 'method',
              code: 'standard',
              name: 'Standard',
              sortOrder: 0,
              rules: [{ ...baseRule, maxDistanceKm }],
            },
          ],
        },
      ],
    }),
  } as unknown as ShippingRepository;
  return new ShippingService(repository);
}

function calculate(
  service: ShippingService,
  latitude: number | null,
  longitude: number | null,
) {
  return service.calculate({
    tenantId: 'tenant-a',
    scopeKey: 'ignored-legacy-scope',
    currency: 'USD',
    orderSubtotalCents: 1000n,
    destination: { countryCode: 'US', latitude, longitude },
    methodCode: 'standard',
  });
}

describe('shipping distance calculation', () => {
  it('returns zero for the same location', () => {
    expect(calculateDistanceKm(0, 0, 0, 0)).toBeCloseTo(0, 10);
  });

  it('calculates a known one-degree equatorial distance in kilometers', () => {
    expect(calculateDistanceKm(0, 0, 0, 1)).toBeCloseTo(111.195, 1);
  });

  it('is symmetric', () => {
    expect(calculateDistanceKm(30, 31, 30.5, 32)).toBeCloseTo(
      calculateDistanceKm(30.5, 32, 30, 31),
      10,
    );
  });

  it('accepts the inclusive maximum distance boundary and rejects above it', async () => {
    const exactlyFiveKmLatitude = (5 / 6371) * (180 / Math.PI);
    const result = await calculate(serviceFor(5), exactlyFiveKmLatitude, 0);
    expect(result.distanceKm).toBeCloseTo(5, 8);
    await expect(
      calculate(serviceFor(5), exactlyFiveKmLatitude + 0.0001, 0),
    ).rejects.toMatchObject({ code: 'SHIPPING_NOT_AVAILABLE' });
  });

  it('rejects missing customer and origin coordinates with controlled errors', async () => {
    await expect(calculate(serviceFor(5), null, null)).rejects.toMatchObject({
      code: 'DELIVERY_COORDINATES_REQUIRED',
      statusCode: 400,
    } satisfies Partial<AppError>);

    const repository = {
      findProfile: async () => ({
        currency: 'USD',
        originLatitude: null,
        originLongitude: null,
        zones: [
          {
            countryCode: 'US',
            methods: [
              {
                id: 'm',
                code: 'standard',
                name: 'Standard',
                rules: [baseRule],
              },
            ],
          },
        ],
      }),
    } as unknown as ShippingRepository;
    await expect(
      calculate(new ShippingService(repository), 0, 0),
    ).rejects.toMatchObject({
      code: 'SHIPPING_ORIGIN_COORDINATES_REQUIRED',
      statusCode: 400,
    });
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => calculateDistanceKm(91, 0, 0, 0)).toThrow(RangeError);
    expect(() => calculateDistanceKm(0, 181, 0, 0)).toThrow(RangeError);
  });
});
