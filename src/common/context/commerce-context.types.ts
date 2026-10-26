export interface CommerceCountry {
  code: string;
  name: string;
  currencyCode: string;
}

export interface CommerceContext {
  country: CommerceCountry;
  countryCode: string;
  currencyCode: string;
}