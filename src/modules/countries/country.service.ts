import type { CountryRepository } from './country.repository.js';

export class CountryService {
  constructor(
    private readonly repository: CountryRepository,
  ) {}

  async getSupportedCountries() {
    return this.repository.findActiveCountries();
  }
}