export interface ShippingAddress {
  countryCode: string;
  regionCode?: string | null;
  city?: string | null;

  latitude?: number | null;
  longitude?: number | null;
}

export interface ShippingCalculationInput {
  scopeKey: string;

  currency: string;

  orderSubtotalCents: bigint;

  destination: ShippingAddress;

  methodCode?: string | null;

  now?: Date;
}

export interface ShippingCalculationResult {
  shippingMethodId: string;
  shippingMethodCode: string;
  shippingMethodName: string;

  shippingRuleId: string;

  amountCents: bigint;

  currency: string;

  orderSubtotalCents: bigint;

  distanceKm: number | null;

  minOrderAmountCents: bigint | null;

  maxOrderAmountCents: bigint | null;

  maxDistanceKm: number | null;
}