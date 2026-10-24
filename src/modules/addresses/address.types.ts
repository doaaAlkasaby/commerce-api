export interface CreateAddressInput {
  label?: string | null;

  firstName: string;
  lastName: string;

  company?: string | null;

  addressLine1: string;
  addressLine2?: string | null;

  city: string;
  state?: string | null;
  postalCode?: string | null;
  country: string;

  phone?: string | null;

  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}

export interface UpdateAddressInput {
  label?: string | null;

  firstName?: string;
  lastName?: string;

  company?: string | null;

  addressLine1?: string;
  addressLine2?: string | null;

  city?: string;
  state?: string | null;
  postalCode?: string | null;
  country?: string;

  phone?: string | null;

  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}