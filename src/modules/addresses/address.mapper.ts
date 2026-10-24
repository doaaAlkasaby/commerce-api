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
  country: string;

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
    country: address.country,

    phone: address.phone,

    isDefaultShipping:
      address.isDefaultShipping,

    isDefaultBilling:
      address.isDefaultBilling,

    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
};