import { AppError } from '../../common/errors/app-error.js';
import { prisma as defaultPrisma } from '../../config/database.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { deviceRepository as defaultRepo } from './device.repository.instance.js';
import type { DeviceRepository } from './device.repository.js';
import type {
  DeviceListResponse,
  DeviceResponse,
  RegisterDeviceInput,
} from './device.types.js';
import { mapDevice } from './device.mapper.js';

export class DeviceService {
  constructor(
    private readonly repository: DeviceRepository = defaultRepo,
    private readonly prisma: PrismaClient = defaultPrisma,
  ) {}

  async registerDevice(
    userId: string,
    input: RegisterDeviceInput,
  ): Promise<DeviceResponse> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.repository.deactivateOtherUsersByToken(
            input.token,
            userId,
            tx,
          );

          const existing = await this.repository.findByUserAndToken(
            userId,
            input.token,
            tx,
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

            const device = await this.repository.update(
              existing.id,
              updateData,
              tx,
            );

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

          const device = await this.repository.create(createData, tx);

          return mapDevice(device);
        });
      } catch (error) {
        if (
          attempt < maxRetries &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034')
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError(
      'Device registration concurrency conflict',
      409,
      'CONCURRENCY_CONFLICT',
    );
  }

  async getUserDevices(userId: string): Promise<DeviceListResponse> {
    const devices = await this.repository.findByUser(userId);

    return {
      items: devices.map(mapDevice),
      total: devices.length,
    };
  }

  async deactivateDevice(
    userId: string,
    deviceId: string,
  ): Promise<DeviceResponse> {
    const device = await this.repository.findById(deviceId);

    if (!device || device.userId !== userId) {
      throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }

    const updated = await this.repository.deactivate(deviceId);

    return mapDevice(updated);
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.repository.findById(deviceId);

    if (!device || device.userId !== userId) {
      throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }

    await this.repository.delete(deviceId);
  }
}

export const deviceService = new DeviceService();
