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

  async findPublicSettings(): Promise<AppSetting[]> {
    return this.prisma.appSetting.findMany({
      where: {
        isPublic: true,
      },
      orderBy: {
        key: 'asc',
      },
    });
  }

  async findByKey(key: string): Promise<AppSetting | null> {
    return this.prisma.appSetting.findUnique({
      where: {
        key,
      },
    });
  }

  async findAll(): Promise<AppSetting[]> {
    return this.prisma.appSetting.findMany({
      orderBy: {
        key: 'asc',
      },
    });
  }

  async create(input: CreateAppSettingRequest): Promise<AppSetting> {
    return this.prisma.appSetting.create({
      data: {
        key: input.key,
        value: input.value === null ? Prisma.JsonNull : input.value,
        description: input.description ?? null,
        isPublic: input.isPublic,
      },
    });
  }

  async update(
    key: string,
    input: UpdateAppSettingRequest,
  ): Promise<AppSetting> {
    return this.prisma.appSetting.update({
      where: {
        key,
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

  async delete(key: string): Promise<AppSetting> {
    return this.prisma.appSetting.delete({
      where: {
        key,
      },
    });
  }
}
