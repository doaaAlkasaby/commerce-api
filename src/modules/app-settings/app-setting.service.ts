import { Prisma } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

import { mapAppSetting, mapPublicSettings } from './app-setting.mapper.js';

import type {
  CreateAppSettingRequest,
  UpdateAppSettingRequest,
} from './app-setting.schemas.js';

import { appSettingRepository } from './app-setting.repository.instance.js';

export class AppSettingService {
  async getPublicSettings() {
    const settings = await appSettingRepository.findPublicSettings();

    return mapPublicSettings(settings);
  }

  async getAllSettings() {
    const settings = await appSettingRepository.findAll();

    return settings.map(mapAppSetting);
  }

  async getSetting(key: string) {
    const setting = await appSettingRepository.findByKey(key);

    if (!setting) {
      throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
    }

    return mapAppSetting(setting);
  }

  async createSetting(input: CreateAppSettingRequest) {
    const existing = await appSettingRepository.findByKey(input.key);

    if (existing) {
      throw new AppError(
        'Setting already exists',
        409,
        'SETTING_ALREADY_EXISTS',
      );
    }

    let setting;
    try {
      setting = await appSettingRepository.create(input);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'Setting already exists',
          409,
          'SETTING_ALREADY_EXISTS',
        );
      }

      throw error;
    }

    return mapAppSetting(setting);
  }

  async updateSetting(key: string, input: UpdateAppSettingRequest) {
    const existing = await appSettingRepository.findByKey(key);

    if (!existing) {
      throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
    }

    let setting;
    try {
      setting = await appSettingRepository.update(key, input);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
      }

      throw error;
    }

    return mapAppSetting(setting);
  }

  async deleteSetting(key: string) {
    const existing = await appSettingRepository.findByKey(key);

    if (!existing) {
      throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
    }

    try {
      await appSettingRepository.delete(key);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
      }

      throw error;
    }

    return null;
  }
}

export const appSettingService = new AppSettingService();
