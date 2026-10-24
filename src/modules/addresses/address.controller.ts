import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { addressService } from './address.service.instance.js';
import { mapAddress } from './address.mapper.js';

export class AddressController {
  async create(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const address =
      await addressService.create(
        req.user!.userId,
        req.validatedBody as any,
      );

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
    const addresses =
      await addressService.getAll(
        req.user!.userId,
      );

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
    const address =
      await addressService.getById(
        req.user!.userId,
        req.validatedParams as any,
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
    const params =
      req.validatedParams as {
        id: string;
      };

    const address =
      await addressService.update(
        req.user!.userId,
        params.id,
        req.validatedBody as any,
      );

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
    const params =
      req.validatedParams as {
        id: string;
      };

    await addressService.delete(
      req.user!.userId,
      params.id,
    );

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
    const params =
      req.validatedParams as {
        id: string;
      };

    const address =
      await addressService.setDefaultShipping(
        req.user!.userId,
        params.id,
      );

    res.status(200).json({
      success: true,
      message:
        'Default shipping address updated successfully',
      data: mapAddress(address),
    });
  }

  async setDefaultBilling(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const params =
      req.validatedParams as {
        id: string;
      };

    const address =
      await addressService.setDefaultBilling(
        req.user!.userId,
        params.id,
      );

    res.status(200).json({
      success: true,
      message:
        'Default billing address updated successfully',
      data: mapAddress(address),
    });
  }
}

export const addressController =
  new AddressController();