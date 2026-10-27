import { Prisma } from '../../generated/prisma/client.js';

import type {
  AppSetting,
  PrismaClient,
} from '../../generated/prisma/client.js';

import type {
  CreateAppSettingRequest,
  UpdateAppSettingRequest,
} from './app-setting.schemas.js';

export class AppSettingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPublicSettings(tenantId: string): Promise<AppSetting[]> {
    return this.prisma.appSetting.findMany({
      where: {
        tenantId,
        isPublic: true,
      },
      orderBy: {
        key: 'asc',
      },
    });
  }

  async findByKey(tenantId: string, key: string): Promise<AppSetting | null> {
    return this.prisma.appSetting.findUnique({
      where: {
        tenantId_key: { tenantId, key },
      },
    });
  }

  async findAll(tenantId: string): Promise<AppSetting[]> {
    return this.prisma.appSetting.findMany({
      where: { tenantId },
      orderBy: {
        key: 'asc',
      },
    });
  }

  async create(tenantId: string, input: CreateAppSettingRequest): Promise<AppSetting> {
    return this.prisma.appSetting.create({
      data: {
        tenantId,
        key: input.key,
        value: input.value === null ? Prisma.JsonNull : input.value,
        description: input.description ?? null,
        isPublic: input.isPublic,
      },
    });
  }

  async update(
    tenantId: string,
    key: string,
    input: UpdateAppSettingRequest,
  ): Promise<AppSetting> {
    return this.prisma.appSetting.update({
      where: {
        tenantId_key: { tenantId, key },
      },
      data: {
        ...(input.value !== undefined
          ? {
              value: input.value === null ? Prisma.JsonNull : input.value,
            }
          : {}),

        ...(input.description !== undefined
          ? { description: input.description }
          : {}),

        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      },
    });
  }

  async delete(tenantId: string, key: string): Promise<AppSetting> {
    return this.prisma.appSetting.delete({
      where: {
        tenantId_key: { tenantId, key },
      },
    });
  }
}
