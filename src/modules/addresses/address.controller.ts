import type { NextFunction, Request, Response } from 'express';

import { addressService } from './address.service.instance.js';
import { mapAddress } from './address.mapper.js';
import {
  createAddressSchema,
  updateAddressSchema,
  addressIdParamsSchema,
} from './address.schemas.js';

export class AddressController {
  async create(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const input = createAddressSchema.parse(req.validatedBody);
    const address = await addressService.create(req.user!.userId, {
      ...input,
      label: input.label ?? null,
      company: input.company ?? null,
      addressLine2: input.addressLine2 ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      phone: input.phone ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    });

    res.status(201).json({
      success: true,
      message: 'Address created successfully',
      data: mapAddress(address),
    });
  }

  async getAll(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const addresses = await addressService.getAll(req.user!.userId);

    res.status(200).json({
      success: true,
      message: null,
      data: addresses.map(mapAddress),
    });
  }

  async getById(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const address = await addressService.getById(
      req.user!.userId,
      addressIdParamsSchema.parse(req.validatedParams).id,
    );

    res.status(200).json({
      success: true,
      message: null,
      data: mapAddress(address),
    });
  }

  async update(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const params = addressIdParamsSchema.parse(req.validatedParams);

    const input = updateAddressSchema.parse(req.validatedBody);
    const address = await addressService.update(req.user!.userId, params.id, {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.company !== undefined ? { company: input.company } : {}),
      ...(input.addressLine1 !== undefined
        ? { addressLine1: input.addressLine1 }
        : {}),
      ...(input.addressLine2 !== undefined
        ? { addressLine2: input.addressLine2 }
        : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.postalCode !== undefined
        ? { postalCode: input.postalCode }
        : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.isDefaultShipping !== undefined
        ? { isDefaultShipping: input.isDefaultShipping }
        : {}),
      ...(input.isDefaultBilling !== undefined
        ? { isDefaultBilling: input.isDefaultBilling }
        : {}),
    });

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: mapAddress(address),
    });
  }

  async delete(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const params = addressIdParamsSchema.parse(req.validatedParams);

    await addressService.delete(req.user!.userId, params.id);

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully',
      data: null,
    });
  }

  async setDefaultShipping(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const params = addressIdParamsSchema.parse(req.validatedParams);

    const address = await addressService.setDefaultShipping(
      req.user!.userId,
      params.id,
    );

    res.status(200).json({
      success: true,
      message: 'Default shipping address updated successfully',
      data: mapAddress(address),
    });
  }

  async setDefaultBilling(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const params = addressIdParamsSchema.parse(req.validatedParams);

    const address = await addressService.setDefaultBilling(
      req.user!.userId,
      params.id,
    );

    res.status(200).json({
      success: true,
      message: 'Default billing address updated successfully',
      data: mapAddress(address),
    });
  }
}

export const addressController = new AddressController();
