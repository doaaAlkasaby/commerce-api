import type { Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { deviceService } from './device.service.instance.js';

const getUserId = (req: Request): string => {
  if (!req.user) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  return req.user.userId;
};

const getDeviceId = (req: Request): string => {
  const { deviceId } = req.validatedParams as { deviceId: string };
  return deviceId;
};

export const registerDevice = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const device = await deviceService.registerDevice(getUserId(req), req.body);

  res.status(200).json({
    success: true,
    message: 'Device registered successfully',
    data: device,
  });
};

export const getDevices = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const result = await deviceService.getUserDevices(getUserId(req));

  res.status(200).json({
    success: true,
    message: 'Devices retrieved successfully',
    data: result,
  });
};

export const deactivateDevice = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const device = await deviceService.deactivateDevice(
    getUserId(req),
    getDeviceId(req),
  );

  res.status(200).json({
    success: true,
    message: 'Device deactivated successfully',
    data: device,
  });
};

export const deleteDevice = async (
  req: Request,
  res: Response,
): Promise<void> => {
  await deviceService.deleteDevice(getUserId(req), getDeviceId(req));

  res.status(200).json({
    success: true,
    message: 'Device deleted successfully',
    data: null,
  });
};
