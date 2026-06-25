import { env } from '@config/env.config';

import { PaymentProvider } from '@common/enums';

import type { PaymentProviderAdapter } from './payment-provider.interface';
import { mockPaymentProvider } from './mock.provider';
import { razorpayProvider } from './razorpay.provider';
import { stripeProvider } from './stripe.provider';

/**
 * Resolves the active payment provider from env.
 * Swap `PAYMENT_PROVIDER` to change gateways without touching business logic.
 */
export const getPaymentProvider = (): PaymentProviderAdapter => {
  switch (env.PAYMENT_PROVIDER) {
    case 'stripe':
      return stripeProvider;
    case 'razorpay':
      return razorpayProvider;
    case 'mock':
    default:
      return mockPaymentProvider;
  }
};

export const resolveProviderName = (): PaymentProvider => getPaymentProvider().name;
