export const mapAddress = (address: {
  id: string;
  userId: string;

  label: string | null;

  firstName: string;
  lastName: string;

  company: string | null;

  addressLine1: string;
  addressLine2: string | null;

  city: string;
  state: string | null;
  postalCode: string | null;
  countryCode: string;
  latitude?: { toNumber(): number } | null;
  longitude?: { toNumber(): number } | null;

  phone: string | null;

  isDefaultShipping: boolean;
  isDefaultBilling: boolean;

  createdAt: Date;
  updatedAt: Date;
}) => {
  return {
    id: address.id,

    label: address.label,

    firstName: address.firstName,
    lastName: address.lastName,

    company: address.company,

    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,

    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.countryCode,
    latitude: address.latitude?.toNumber() ?? null,
    longitude: address.longitude?.toNumber() ?? null,

    phone: address.phone,

    isDefaultShipping: address.isDefaultShipping,

    isDefaultBilling: address.isDefaultBilling,

    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
};
