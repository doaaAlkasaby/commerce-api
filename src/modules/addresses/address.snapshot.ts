export interface OrderAddressSnapshot {
  firstName: string;
  lastName: string;

  company: string | null;

  addressLine1: string;
  addressLine2: string | null;

  city: string;
  state: string | null;
  postalCode: string | null;

  country: string;

  phone: string | null;
}

export interface AddressForSnapshot {
  firstName: string;
  lastName: string;

  company: string | null;

  addressLine1: string;
  addressLine2: string | null;

  city: string;
  state: string | null;
  postalCode: string | null;

  country: string;

  phone: string | null;
}

export const createOrderAddressSnapshot = (
  address: AddressForSnapshot,
): OrderAddressSnapshot => {
  return {
    firstName: address.firstName,
    lastName: address.lastName,

    company: address.company,

    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,

    city: address.city,
    state: address.state,
    postalCode: address.postalCode,

    country: address.country,

    phone: address.phone,
  };
};