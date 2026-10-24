import {
  PaymentMethod,
  PaymentProvider,
} from '../../../generated/prisma/client.js';

import { AppError } from '../../../common/errors/app-error.js';

import type {
  PaymentProviderAdapter,
} from './payment-provider.js';

import {
  CashOnDeliveryProvider,
} from './cash-on-delivery.provider.js';

export class PaymentProviderRegistry {
  private readonly providers: Map<
    PaymentProvider,
    PaymentProviderAdapter
  >;

  constructor() {
    const cashOnDelivery =
      new CashOnDeliveryProvider();

    this.providers = new Map([
      [
        PaymentProvider.NONE,
        cashOnDelivery,
      ],
    ]);
  }

  getProvider(
    provider: PaymentProvider,
  ): PaymentProviderAdapter {
    const paymentProvider =
      this.providers.get(provider);

    if (!paymentProvider) {
      throw new AppError(
        `Payment provider ${provider} is not configured`,
        400,
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
      );
    }

    return paymentProvider;
  }

  resolveProviderForMethod(
    method: PaymentMethod,
  ): PaymentProvider {
    switch (method) {
      case PaymentMethod.CASH_ON_DELIVERY:
        return PaymentProvider.NONE;

      case PaymentMethod.CARD:
        throw new AppError(
          'Card payment provider is not configured yet',
          400,
          'CARD_PAYMENT_NOT_CONFIGURED',
        );

      case PaymentMethod.DIGITAL_WALLET:
        throw new AppError(
          'Digital wallet provider is not configured yet',
          400,
          'DIGITAL_WALLET_PAYMENT_NOT_CONFIGURED',
        );

      case PaymentMethod.BANK_TRANSFER:
        return PaymentProvider.NONE;

      default:
        throw new AppError(
          'Unsupported payment method',
          400,
          'UNSUPPORTED_PAYMENT_METHOD',
        );
    }
  }
}