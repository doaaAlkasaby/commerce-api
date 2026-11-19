import type { AppSetting } from '../../generated/prisma/client.js';

import type {
  AppSettingValue,
  AppSettingsResponse,
  PublicFAQItem,
} from './app-setting.types.js';

export const mapAppSetting = (setting: AppSetting): AppSettingValue => ({
  key: setting.key,
  value: setting.value,
  description: setting.description,
  isPublic: setting.isPublic,
});

const parseStringSetting = (val: unknown): string | undefined => {
  if (typeof val === 'string' && val.trim().length > 0) {
    return val.trim();
  }
  return undefined;
};

const parseHttpsUrlSetting = (val: unknown): string | undefined => {
  if (typeof val === 'string' && val.trim().length > 0) {
    const trimmed = val.trim();
    try {
      const uri = new URL(trimmed);
      if (uri.protocol === 'https:') {
        return trimmed;
      }
    } catch (_) {
      return undefined;
    }
  }
  return undefined;
};

const parseFAQSetting = (val: unknown): PublicFAQItem[] | undefined => {
  if (!Array.isArray(val)) return undefined;

  const validItems: PublicFAQItem[] = [];
  for (const item of val) {
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const question =
        typeof record.question === 'string'
          ? record.question.trim()
          : typeof record.q === 'string'
            ? record.q.trim()
            : '';
      const answer =
        typeof record.answer === 'string'
          ? record.answer.trim()
          : typeof record.a === 'string'
            ? record.a.trim()
            : '';

      if (question.length > 0 && answer.length > 0) {
        validItems.push({ question, answer });
      }
    }
  }

  return validItems.length > 0 ? validItems : undefined;
};

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

  const supportEmail = parseStringSetting(settingsMap.get('support_email'));
  const supportPhone = parseStringSetting(settingsMap.get('support_phone'));
  const whatsapp = parseStringSetting(settingsMap.get('whatsapp'));
  const businessHours = parseStringSetting(settingsMap.get('business_hours'));
  const shippingPolicy = parseStringSetting(settingsMap.get('shipping_policy'));
  const returnPolicy = parseStringSetting(settingsMap.get('return_policy'));
  const privacyPolicyUrl = parseHttpsUrlSetting(settingsMap.get('privacy_policy_url'));
  const termsUrl = parseHttpsUrlSetting(settingsMap.get('terms_url'));
  const faq = parseFAQSetting(settingsMap.get('faq'));

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

    ...(supportEmail ? { support_email: supportEmail } : {}),
    ...(supportPhone ? { support_phone: supportPhone } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(businessHours ? { business_hours: businessHours } : {}),
    ...(shippingPolicy ? { shipping_policy: shippingPolicy } : {}),
    ...(returnPolicy ? { return_policy: returnPolicy } : {}),
    ...(privacyPolicyUrl ? { privacy_policy_url: privacyPolicyUrl } : {}),
    ...(termsUrl ? { terms_url: termsUrl } : {}),
    ...(faq ? { faq } : {}),
  };
};
