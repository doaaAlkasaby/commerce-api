import type { DevicePlatform } from '../../generated/prisma/client.js';

export interface RegisterDeviceInput {
  token: string;
  platform: DevicePlatform;
  appVersion?: string;
}

export interface DeviceResponse {
  id: string;
  token: string;
  platform: DevicePlatform;
  appVersion: string | null;
  isActive: boolean;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceListResponse {
  items: DeviceResponse[];
  total: number;
}