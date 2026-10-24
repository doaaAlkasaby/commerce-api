export interface AppSettingsResponse {
  android_build: number[];
  ios_build: number[];
  forceUpdate: boolean;
  currency_ar: string;
  currency_en: string;
  features: string[];
}

export interface AppSettingValue {
  key: string;
  value: unknown;
  description: string | null;
  isPublic: boolean;
}
