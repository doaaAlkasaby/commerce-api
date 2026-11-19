import type {
  Prisma,
  PrismaClient,
  UserDevice,
} from '../../generated/prisma/client.js';

export class DeviceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserAndToken(
    userId: string,
    token: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserDevice | null> {
    const client = tx ?? this.prisma;
    return client.userDevice.findUnique({
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
    tx?: Prisma.TransactionClient,
  ): Promise<UserDevice | null> {
    const client = tx ?? this.prisma;
    return client.userDevice.findUnique({
      where: {
        id: deviceId,
      },
    });
  }

  async findByUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserDevice[]> {
    const client = tx ?? this.prisma;
    return client.userDevice.findMany({
      where: {
        userId,
      },
      orderBy: {
        lastUsedAt: 'desc',
      },
    });
  }

  async deactivateOtherUsersByToken(
    token: string,
    currentUserId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.userDevice.updateMany({
      where: {
        token,
        userId: { not: currentUserId },
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
  }

  async create(
    data: {
      userId: string;
      token: string;
      platform: 'ANDROID' | 'IOS';
      appVersion?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<UserDevice> {
    const client = tx ?? this.prisma;
    return client.userDevice.create({
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
    tx?: Prisma.TransactionClient,
  ): Promise<UserDevice> {
    const client = tx ?? this.prisma;
    return client.userDevice.update({
      where: {
        id: deviceId,
      },
      data,
    });
  }

  async deactivate(
    deviceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserDevice> {
    const client = tx ?? this.prisma;
    return client.userDevice.update({
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
    tx?: Prisma.TransactionClient,
  ): Promise<UserDevice> {
    const client = tx ?? this.prisma;
    return client.userDevice.delete({
      where: {
        id: deviceId,
      },
    });
  }
}
