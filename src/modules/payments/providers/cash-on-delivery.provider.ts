import {
  PaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/client.js';

import type {
  PaymentProviderAdapter,
} from './payment-provider.js';

export class CashOnDeliveryProvider
  implements PaymentProviderAdapter
{
  readonly provider =
    PaymentProvider.NONE;

  async createPayment(): Promise<{
    status: PaymentStatus;
  }> {
    return {
      status: PaymentStatus.PENDING,
    };
  }

  async cancelPayment(): Promise<{
    status: PaymentStatus;
  }> {
    return {
      status: PaymentStatus.CANCELLED,
    };
  }

  async refundPayment(): Promise<{
    status: PaymentStatus;
    providerTransactionId: null;
  }> {
    return {
      status: PaymentStatus.REFUNDED,
      providerTransactionId: null,
    };
  }
}