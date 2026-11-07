import { AppError } from '../errors/app-error.js';

import type {
  CommerceContext,
  CommerceCountry,
} from './commerce-context.types.js';

import { CommerceContextRepository } from './commerce-context.repository.js';

export interface ResolveCommerceContextInput {
  countryCode?: string | null;
  userId?: string | null;
}

export class CommerceContextService {
  constructor(private readonly repository: CommerceContextRepository) {}

  async resolve(input: ResolveCommerceContextInput): Promise<CommerceContext> {
    const requestedCountryCode = input.countryCode?.trim().toUpperCase();

    let country: CommerceCountry | null = null;

    if (requestedCountryCode) {
      country = await this.repository.findCountryByCode(requestedCountryCode);

      if (!country) {
        throw new AppError(
          'The selected country is not supported.',
          400,
          'COUNTRY_NOT_SUPPORTED',
        );
      }
    }

    if (!country && input.userId) {
      const user = await this.repository.findUserDefaultCountry(input.userId);

      if (user?.defaultCountry) {
        country = user.defaultCountry;
      }
    }

    if (!country) {
      throw new AppError(
        'A shopping country is required.',
        400,
        'COUNTRY_REQUIRED',
      );
    }

    return {
      country,
      countryCode: country.code,
      currencyCode: country.currencyCode,
    };
  }
}
