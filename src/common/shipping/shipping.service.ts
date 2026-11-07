import { toMinorUnits } from '../pricing/money.js';
import { AppError } from '../errors/app-error.js';

import { calculateDistanceKm } from './shipping.calculator.js';

import type {
  ShippingCalculationInput,
  ShippingCalculationResult,
} from './shipping.types.js';

import type { ShippingRepository } from './shipping.repository.js';

type Profile = NonNullable<
  Awaited<ReturnType<ShippingRepository['findProfile']>>
>;
type Zone = Profile['zones'][number];
type Method = Zone['methods'][number];
type Rule = Method['rules'][number];

export class ShippingService {
  constructor(private readonly repository: ShippingRepository) {}

  async calculate(
    input: ShippingCalculationInput,
  ): Promise<ShippingCalculationResult> {
    if (input.methodCode) return this.calculateSelected(input);
    const profile = await this.repository.findProfile(
      input.tenantId,
      input.destination.countryCode,
    );
    if (!profile) return this.calculateSelected(input);
    const zone = this.findZone(profile.zones, input.destination);
    if (!zone) return this.calculateSelected(input);
    let failure: AppError | undefined;
    for (const method of zone.methods
      .slice()
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
      )) {
      try {
        return await this.calculateSelected({
          ...input,
          methodCode: method.code,
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode >= 500)
          throw error;
        failure = error;
      }
    }
    if (failure) throw failure;
    return this.calculateSelected(input);
  }

  private async calculateSelected(
    input: ShippingCalculationInput,
  ): Promise<ShippingCalculationResult> {
    const profile = await this.repository.findProfile(
      input.tenantId,
      input.destination.countryCode,
    );

    if (!profile) {
      throw new AppError(
        'Shipping is not configured for this country.',
        400,
        'SHIPPING_PROFILE_NOT_CONFIGURED',
      );
    }

    if (profile.currency !== input.currency) {
      throw new AppError(
        'Shipping profile currency does not match the tenant currency.',
        500,
        'SHIPPING_CURRENCY_MISMATCH',
      );
    }

    const zone = this.findZone(profile.zones, input.destination);

    if (!zone) {
      throw new AppError(
        'Delivery is not available for this destination.',
        400,
        'SHIPPING_ZONE_NOT_AVAILABLE',
      );
    }

    const method = this.findMethod(zone.methods, input.methodCode);

    if (!method) {
      throw new AppError(
        'The selected shipping method is not available.',
        400,
        'SHIPPING_METHOD_NOT_AVAILABLE',
      );
    }

    const distanceKm = this.calculateDestinationDistance(
      input.origin ? input.origin.latitude : profile.originLatitude,
      input.origin ? input.origin.longitude : profile.originLongitude,
      input.destination.latitude,
      input.destination.longitude,
    );

    const amountRules = method.rules.filter((rule) =>
      this.matchesOrderAmount(rule, input.orderSubtotalCents, input.currency),
    );
    const distanceIsRequired =
      amountRules.length > 0 &&
      amountRules.every((rule) => rule.maxDistanceKm != null);

    if (distanceKm == null && distanceIsRequired) {
      if (
        (input.origin ? input.origin.latitude : profile.originLatitude) ==
          null &&
        (input.origin ? input.origin.longitude : profile.originLongitude) ==
          null
      ) {
        throw new AppError(
          'Shipping origin coordinates are required to calculate delivery distance.',
          400,
          'SHIPPING_ORIGIN_COORDINATES_REQUIRED',
        );
      }

      throw new AppError(
        'Delivery address coordinates are required to calculate delivery distance.',
        400,
        'DELIVERY_COORDINATES_REQUIRED',
      );
    }

    const rule = this.findApplicableRule(
      method.rules,
      input.orderSubtotalCents,
      distanceKm,
      input.currency,
    );

    if (!rule) {
      throw new AppError(
        'No shipping option is available for this order and destination.',
        400,
        'SHIPPING_NOT_AVAILABLE',
      );
    }

    return {
      shippingMethodId: method.id,
      shippingMethodCode: method.code,
      shippingMethodName: method.name,

      shippingRuleId: rule.id,

      amountCents:
        rule.rateType === 'FREE'
          ? 0n
          : toMinorUnits(String(rule.flatRate), input.currency),

      currency: profile.currency,

      orderSubtotalCents: input.orderSubtotalCents,

      distanceKm,

      minOrderAmountCents: rule.minOrderAmount
        ? toMinorUnits(String(rule.minOrderAmount), input.currency)
        : null,

      maxOrderAmountCents: rule.maxOrderAmount
        ? toMinorUnits(String(rule.maxOrderAmount), input.currency)
        : null,

      maxDistanceKm: rule.maxDistanceKm ? Number(rule.maxDistanceKm) : null,
    };
  }

  private findZone(
    zones: Zone[],
    destination: ShippingCalculationInput['destination'],
  ) {
    const normalize = (value: string | null | undefined) =>
      value?.trim().toLowerCase();
    const countryMatches = zones.filter(
      (zone) =>
        zone.countryCode === destination.countryCode &&
        (!zone.regionCode ||
          normalize(zone.regionCode) === normalize(destination.regionCode)) &&
        (!zone.city || normalize(zone.city) === normalize(destination.city)),
    );

    if (countryMatches.length === 0) {
      return null;
    }

    const specificity = (zone: Zone) =>
      (zone.regionCode ? 2 : 0) + (zone.city ? 1 : 0);
    return (
      countryMatches.sort(
        (a, b) =>
          specificity(b) - specificity(a) || a.code.localeCompare(b.code),
      )[0] ?? null
    );
  }

  private findMethod(methods: Method[], methodCode?: string | null) {
    if (methodCode) {
      return methods.find((method) => method.code === methodCode) ?? null;
    }

    return methods.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
  }

  private calculateDestinationDistance(
    originLatitude: unknown,
    originLongitude: unknown,
    destinationLatitude?: number | null,
    destinationLongitude?: number | null,
  ): number | null {
    const hasOriginLatitude = originLatitude != null;
    const hasOriginLongitude = originLongitude != null;
    if (hasOriginLatitude !== hasOriginLongitude) {
      throw new AppError(
        'Shipping origin must have both latitude and longitude configured.',
        400,
        'SHIPPING_ORIGIN_COORDINATES_INCOMPLETE',
      );
    }

    const hasDestinationLatitude = destinationLatitude != null;
    const hasDestinationLongitude = destinationLongitude != null;
    if (hasDestinationLatitude !== hasDestinationLongitude) {
      throw new AppError(
        'Delivery address must include both latitude and longitude.',
        400,
        'DELIVERY_COORDINATES_INCOMPLETE',
      );
    }

    if (!hasOriginLatitude || !hasDestinationLatitude) {
      return null;
    }

    try {
      return calculateDistanceKm(
        Number(originLatitude),
        Number(originLongitude),
        destinationLatitude!,
        destinationLongitude!,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        throw new AppError(error.message, 400, 'INVALID_SHIPPING_COORDINATES');
      }
      throw error;
    }
  }

  private findApplicableRule(
    rules: Rule[],
    orderSubtotalCents: bigint,
    distanceKm: number | null,
    currency: string,
  ) {
    for (const rule of rules) {
      if (!this.matchesOrderAmount(rule, orderSubtotalCents, currency)) {
        continue;
      }

      if (rule.maxDistanceKm != null && distanceKm == null) continue;
      if (!this.matchesDistance(rule, distanceKm)) {
        continue;
      }

      return rule;
    }

    return null;
  }

  private matchesOrderAmount(
    rule: Rule,
    orderSubtotalCents: bigint,
    currency: string,
  ): boolean {
    if (rule.minOrderAmount != null) {
      const minimum = toMinorUnits(String(rule.minOrderAmount), currency);

      if (orderSubtotalCents < minimum) {
        return false;
      }
    }

    if (rule.maxOrderAmount != null) {
      const maximum = toMinorUnits(String(rule.maxOrderAmount), currency);

      if (orderSubtotalCents > maximum) {
        return false;
      }
    }

    return true;
  }

  private matchesDistance(rule: Rule, distanceKm: number | null): boolean {
    if (rule.maxDistanceKm == null) {
      return true;
    }

    if (distanceKm == null) {
      throw new AppError(
        'A delivery location is required to calculate delivery distance.',
        400,
        'DELIVERY_LOCATION_REQUIRED',
      );
    }

    return distanceKm <= Number(rule.maxDistanceKm);
  }
}
