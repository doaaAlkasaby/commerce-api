import { Prisma } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

import { mapAppSetting, mapPublicSettings } from './app-setting.mapper.js';
import {
  CART_RECOMMENDATIONS_SETTING_KEY,
  COMPLEMENTARY_PRODUCTS_SETTING_KEY,
  SIMILAR_PRODUCTS_SETTING_KEY,
  assertValidBooleanStorefrontSettingCreate,
  assertValidBooleanStorefrontSettingEffectiveState,
  assertValidBooleanStorefrontSettingUpdateInput,
  isStrictBooleanStorefrontSettingKey,
} from './similar-products-settings.js';

import type {
  CreateAppSettingRequest,
  UpdateAppSettingRequest,
} from './app-setting.schemas.js';

import { appSettingRepository } from './app-setting.repository.instance.js';

export class AppSettingService {
  async getPublicSettings(tenantId: string) {
    const [settings, featureSettings] = await Promise.all([
      appSettingRepository.findPublicSettings(tenantId),
      appSettingRepository.findByKeys(tenantId, [
        SIMILAR_PRODUCTS_SETTING_KEY,
        COMPLEMENTARY_PRODUCTS_SETTING_KEY,
        CART_RECOMMENDATIONS_SETTING_KEY,
      ]),
    ]);

    const showSimilarProductsSetting =
      featureSettings.find((row) => row.key === SIMILAR_PRODUCTS_SETTING_KEY) ??
      null;
    const showComplementaryProductsSetting =
      featureSettings.find(
        (row) => row.key === COMPLEMENTARY_PRODUCTS_SETTING_KEY,
      ) ?? null;
    const showCartRecommendationsSetting =
      featureSettings.find(
        (row) => row.key === CART_RECOMMENDATIONS_SETTING_KEY,
      ) ?? null;

    return mapPublicSettings(settings, {
      showSimilarProductsSetting,
      showComplementaryProductsSetting,
      showCartRecommendationsSetting,
    });
  }

  async getAllSettings(tenantId: string) {
    const settings = await appSettingRepository.findAll(tenantId);

    return settings.map(mapAppSetting);
  }

  async getSetting(tenantId: string, key: string) {
    const setting = await appSettingRepository.findByKey(tenantId, key);

    if (!setting) {
      throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
    }

    return mapAppSetting(setting);
  }

  async createSetting(tenantId: string, input: CreateAppSettingRequest) {
    if (isStrictBooleanStorefrontSettingKey(input.key)) {
      assertValidBooleanStorefrontSettingCreate(input.key, {
        value: input.value,
        isPublic: input.isPublic,
      });
    }

    const existing = await appSettingRepository.findByKey(tenantId, input.key);

    if (existing) {
      throw new AppError(
        'Setting already exists',
        409,
        'SETTING_ALREADY_EXISTS',
      );
    }

    let setting;
    try {
      setting = await appSettingRepository.create(tenantId, input);
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

  async updateSetting(tenantId: string, key: string, input: UpdateAppSettingRequest) {
    if (isStrictBooleanStorefrontSettingKey(key)) {
      assertValidBooleanStorefrontSettingUpdateInput(key, input);
    }

    const existing = await appSettingRepository.findByKey(tenantId, key);

    if (!existing) {
      throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
    }

    if (isStrictBooleanStorefrontSettingKey(key)) {
      assertValidBooleanStorefrontSettingEffectiveState(key, {
        value: input.value !== undefined ? input.value : existing.value,
        isPublic:
          input.isPublic !== undefined ? input.isPublic : existing.isPublic,
      });
    }

    let setting;
    try {
      setting = await appSettingRepository.update(tenantId, key, input);
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

  async deleteSetting(tenantId: string, key: string) {
    const existing = await appSettingRepository.findByKey(tenantId, key);

    if (!existing) {
      throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
    }

    try {
      await appSettingRepository.delete(tenantId, key);
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
