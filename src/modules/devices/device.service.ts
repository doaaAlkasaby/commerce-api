import { AppError } from '../../common/errors/app-error.js';
import { deviceRepository } from './device.repository.instance.js';
import type {
  DeviceListResponse,
  DeviceResponse,
  RegisterDeviceInput,
} from './device.types.js';
import { mapDevice } from './device.mapper.js';

export class DeviceService {
  async registerDevice(
    userId: string,
    input: RegisterDeviceInput,
  ): Promise<DeviceResponse> {
    const existing = await deviceRepository.findByUserAndToken(
      userId,
      input.token,
    );

    if (existing) {
      const updateData: {
        platform: 'ANDROID' | 'IOS';
        appVersion?: string;
        isActive: boolean;
        lastUsedAt: Date;
      } = {
        platform: input.platform,
        isActive: true,
        lastUsedAt: new Date(),
      };

      if (input.appVersion !== undefined) {
        updateData.appVersion = input.appVersion;
      }

      const device = await deviceRepository.update(existing.id, updateData);

      return mapDevice(device);
    }

    const createData: {
      userId: string;
      token: string;
      platform: 'ANDROID' | 'IOS';
      appVersion?: string;
    } = {
      userId,
      token: input.token,
      platform: input.platform,
    };

    if (input.appVersion !== undefined) {
      createData.appVersion = input.appVersion;
    }

    const device = await deviceRepository.create(createData);

    return mapDevice(device);
  }

  async getUserDevices(userId: string): Promise<DeviceListResponse> {
    const devices = await deviceRepository.findByUser(userId);

    return {
      items: devices.map(mapDevice),
      total: devices.length,
    };
  }

  async deactivateDevice(
    userId: string,
    deviceId: string,
  ): Promise<DeviceResponse> {
    const device = await deviceRepository.findById(deviceId);

    if (!device || device.userId !== userId) {
      throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }

    const updated = await deviceRepository.deactivate(deviceId);

    return mapDevice(updated);
  }

  async deleteDevice(
    userId: string,
    deviceId: string,
  ): Promise<void> {
    const device = await deviceRepository.findById(deviceId);

    if (!device || device.userId !== userId) {
      throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }

    await deviceRepository.delete(deviceId);
  }
}

export const deviceService = new DeviceService();