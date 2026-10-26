import type {
  PrismaClient,
  UserDevice,
} from '../../generated/prisma/client.js';

export class DeviceRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findByUserAndToken(
    userId: string,
    token: string,
  ): Promise<UserDevice | null> {
    return this.prisma.userDevice.findUnique({
      where: {
        userId_token: {
          userId,
          token,
        },
      },
    });
  }

  async findById(
    deviceId: string,
  ): Promise<UserDevice | null> {
    return this.prisma.userDevice.findUnique({
      where: {
        id: deviceId,
      },
    });
  }

  async findByUser(
    userId: string,
  ): Promise<UserDevice[]> {
    return this.prisma.userDevice.findMany({
      where: {
        userId,
      },
      orderBy: {
        lastUsedAt: 'desc',
      },
    });
  }

  async create(data: {
    userId: string;
    token: string;
    platform: 'ANDROID' | 'IOS';
    appVersion?: string;
  }): Promise<UserDevice> {
    return this.prisma.userDevice.create({
      data: {
        userId: data.userId,
        token: data.token,
        platform: data.platform,
        appVersion: data.appVersion ?? null,
        isActive: true,
        lastUsedAt: new Date(),
      },
    });
  }

  async update(
    deviceId: string,
    data: {
      platform?: 'ANDROID' | 'IOS';
      appVersion?: string | null;
      isActive?: boolean;
      lastUsedAt?: Date;
    },
  ): Promise<UserDevice> {
    return this.prisma.userDevice.update({
      where: {
        id: deviceId,
      },
      data,
    });
  }

  async deactivate(
    deviceId: string,
  ): Promise<UserDevice> {
    return this.prisma.userDevice.update({
      where: {
        id: deviceId,
      },
      data: {
        isActive: false,
      },
    });
  }

  async delete(
    deviceId: string,
  ): Promise<UserDevice> {
    return this.prisma.userDevice.delete({
      where: {
        id: deviceId,
      },
    });
  }
}