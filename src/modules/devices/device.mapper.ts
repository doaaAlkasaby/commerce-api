import type { UserDevice } from '../../generated/prisma/client.js';
import type { DeviceResponse } from './device.types.js';

export const mapDevice = (
  device: UserDevice,
): DeviceResponse => ({
  id: device.id,
  token: device.token,
  platform: device.platform,
  appVersion: device.appVersion,
  isActive: device.isActive,
  lastUsedAt: device.lastUsedAt,
  createdAt: device.createdAt,
  updatedAt: device.updatedAt,
});