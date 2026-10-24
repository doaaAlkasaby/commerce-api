import type { AppSetting } from '../../generated/prisma/client.js';

import type {
  AppSettingValue,
  AppSettingsResponse,
} from './app-setting.types.js';

export const mapAppSetting = (setting: AppSetting): AppSettingValue => ({
  key: setting.key,
  value: setting.value,
  description: setting.description,
  isPublic: setting.isPublic,
});

export const mapPublicSettings = (
  settings: AppSetting[],
): AppSettingsResponse => {
  const settingsMap = new Map(
    settings.map((setting) => [setting.key, setting.value]),
  );

  const androidBuild = settingsMap.get('android_build');
  const iosBuild = settingsMap.get('ios_build');
  const forceUpdate = settingsMap.get('forceUpdate');
  const currencyAr = settingsMap.get('currency_ar');
  const currencyEn = settingsMap.get('currency_en');
  const features = settingsMap.get('features');

  return {
    android_build: Array.isArray(androidBuild)
      ? androidBuild.filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value),
        )
      : [],

    ios_build: Array.isArray(iosBuild)
      ? iosBuild.filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value),
        )
      : [],

    forceUpdate: typeof forceUpdate === 'boolean' ? forceUpdate : false,

    currency_ar: typeof currencyAr === 'string' ? currencyAr : '',

    currency_en: typeof currencyEn === 'string' ? currencyEn : '',

    features: Array.isArray(features)
      ? features.filter((value): value is string => typeof value === 'string')
      : [],
  };
};
