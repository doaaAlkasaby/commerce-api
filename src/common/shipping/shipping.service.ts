import {
  AppError,
} from '../errors/app-error.js';

import {
  calculateDistanceKm,
} from './shipping.calculator.js';

import type {
  ShippingCalculationInput,
  ShippingCalculationResult,
} from './shipping.types.js';

import type {
  ShippingRepository,
} from './shipping.repository.js';

export class ShippingService {
  constructor(
    private readonly repository: ShippingRepository,
  ) {}

  async calculate(
    input: ShippingCalculationInput,
  ): Promise<ShippingCalculationResult> {
    const profile =
      await this.repository.findProfile(
        input.scopeKey,
      );

    if (!profile) {
      throw new AppError(
        'SHIPPING_PROFILE_NOT_CONFIGURED',
        'Shipping is not configured for this country.',
        400,
      );
    }

    const zone = this.findZone(
      profile.zones,
      input.destination,
    );

    if (!zone) {
      throw new AppError(
        'SHIPPING_ZONE_NOT_AVAILABLE',
        'Delivery is not available for this destination.',
        400,
      );
    }

    const method = this.findMethod(
      zone.methods,
      input.methodCode,
    );

    if (!method) {
      throw new AppError(
        'SHIPPING_METHOD_NOT_AVAILABLE',
        'The selected shipping method is not available.',
        400,
      );
    }

    const distanceKm =
      this.calculateDestinationDistance(
        profile.originLatitude,
        profile.originLongitude,
        input.destination.latitude,
        input.destination.longitude,
      );

    const rule = this.findApplicableRule(
      method.rules,
      input.orderSubtotalCents,
      distanceKm,
    );

    if (!rule) {
      throw new AppError(
        'SHIPPING_NOT_AVAILABLE',
        'No shipping option is available for this order and destination.',
        400,
      );
    }

    return {
      shippingMethodId: method.id,
      shippingMethodCode: method.code,
      shippingMethodName: method.name,

      shippingRuleId: rule.id,

      amountCents: decimalToCents(
        rule.flatRate,
      ),

      currency: profile.currency,

      orderSubtotalCents:
        input.orderSubtotalCents,

      distanceKm,

      minOrderAmountCents:
        rule.minOrderAmount
          ? decimalToCents(rule.minOrderAmount)
          : null,

      maxOrderAmountCents:
        rule.maxOrderAmount
          ? decimalToCents(rule.maxOrderAmount)
          : null,

      maxDistanceKm:
        rule.maxDistanceKm
          ? Number(rule.maxDistanceKm)
          : null,
    };
  }

  private findZone(
    zones: any[],
    destination: ShippingCalculationInput['destination'],
  ) {
    const countryMatches = zones.filter(
      (zone) =>
        zone.countryCode ===
        destination.countryCode,
    );

    if (countryMatches.length === 0) {
      return null;
    }

    const exactRegion = countryMatches.find(
      (zone) =>
        zone.regionCode &&
        zone.regionCode ===
          destination.regionCode,
    );

    if (exactRegion) {
      return exactRegion;
    }

    const exactCity = countryMatches.find(
      (zone) =>
        zone.city &&
        zone.city.toLowerCase() ===
          destination.city?.toLowerCase(),
    );

    if (exactCity) {
      return exactCity;
    }

    return countryMatches.find(
      (zone) =>
        !zone.regionCode &&
        !zone.city,
    ) ?? null;
  }

  private findMethod(
    methods: any[],
    methodCode?: string | null,
  ) {
    if (methodCode) {
      return (
        methods.find(
          (method) =>
            method.code === methodCode,
        ) ?? null
      );
    }

    return (
      methods
        .slice()
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder,
        )[0] ?? null
    );
  }

  private calculateDestinationDistance(
    originLatitude: unknown,
    originLongitude: unknown,
    destinationLatitude?: number | null,
    destinationLongitude?: number | null,
  ): number | null {
    if (
      originLatitude == null ||
      originLongitude == null
    ) {
      return null;
    }

    const hasDestinationCoordinates =
      destinationLatitude != null &&
      destinationLongitude != null;

    if (!hasDestinationCoordinates) {
      return null;
    }

    return calculateDistanceKm(
      Number(originLatitude),
      Number(originLongitude),
      destinationLatitude,
      destinationLongitude,
    );
  }

  private findApplicableRule(
    rules: any[],
    orderSubtotalCents: bigint,
    distanceKm: number | null,
  ) {
    for (const rule of rules) {
      if (
        !this.matchesOrderAmount(
          rule,
          orderSubtotalCents,
        )
      ) {
        continue;
      }

      if (
        !this.matchesDistance(
          rule,
          distanceKm,
        )
      ) {
        continue;
      }

      return rule;
    }

    return null;
  }

  private matchesOrderAmount(
    rule: any,
    orderSubtotalCents: bigint,
  ): boolean {
    if (rule.minOrderAmount != null) {
      const minimum =
        decimalToCents(
          rule.minOrderAmount,
        );

      if (orderSubtotalCents < minimum) {
        return false;
      }
    }

    if (rule.maxOrderAmount != null) {
      const maximum =
        decimalToCents(
          rule.maxOrderAmount,
        );

      if (orderSubtotalCents > maximum) {
        return false;
      }
    }

    return true;
  }

  private matchesDistance(
    rule: any,
    distanceKm: number | null,
  ): boolean {
    if (rule.maxDistanceKm == null) {
      return true;
    }

    if (distanceKm == null) {
      throw new AppError(
        'DELIVERY_LOCATION_REQUIRED',
        'A delivery location is required to calculate delivery distance.',
        400,
      );
    }

    return (
      distanceKm <=
      Number(rule.maxDistanceKm)
    );
  }
}

function decimalToCents(
  value: unknown,
): bigint {
  const normalized =
    String(value);

  const [whole, fraction = ''] =
    normalized.split('.');

  const paddedFraction =
    fraction.padEnd(2, '0').slice(0, 2);

  return (
    BigInt(whole) * 100n +
    BigInt(paddedFraction || '0')
  );
}