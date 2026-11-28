export interface PublicFAQItem {
  question: string;
  answer: string;
}

export interface AppSettingsResponse {
  specialOrders: { enabled: boolean; instructionsAr: string | null; instructionsEn: string | null };
  showSimilarProducts: boolean;
  showComplementaryProducts: boolean;
  showCartRecommendations: boolean;
  android_build: number[];
  ios_build: number[];
  forceUpdate: boolean;
  currency_ar: string;
  currency_en: string;
  features: string[];
  support_email?: string;
  support_phone?: string;
  whatsapp?: string;
  business_hours?: string;
  shipping_policy?: string;
  return_policy?: string;
  privacy_policy_url?: string;
  terms_url?: string;
  faq?: PublicFAQItem[];
}

export interface AppSettingValue {
  key: string;
  value: unknown;
  description: string | null;
  isPublic: boolean;
}
