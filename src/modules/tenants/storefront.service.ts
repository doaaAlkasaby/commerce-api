import { tenantService } from './tenant.service.instance.js';
import { tenantRepository } from './tenant.repository.instance.js';
import { appSettingService } from '../app-settings/app-setting.service.instance.js';
import { normalizeCurrency } from '../../common/pricing/currency.js';
import { AppError } from '../../common/errors/app-error.js';

export async function publicStorefront(slug: string) {
  const tenant = await tenantService.getTenantBySlug(slug);
  if (tenant.status !== 'ACTIVE')
    throw new AppError('Store is unavailable', 401, 'UNAUTHORIZED');
  if (!tenant.defaultCurrency)
    throw new AppError(
      'Tenant currency is not configured',
      409,
      'TENANT_CURRENCY_NOT_CONFIGURED',
    );
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    logoUrl: tenant.logoUrl,
    currency: normalizeCurrency(tenant.defaultCurrency),
    timezone: tenant.timezone,
    settings: await appSettingService.getPublicSettings(tenant.id),
  };
}

export async function listPublicStorefronts() {
  const stores = await tenantRepository.listPublicStores();
  return stores.map((store) => ({
    id: store.id,
    slug: store.slug,
    name: store.name,
    logoUrl: store.logoUrl,
    coverImageUrl: store.coverImageUrl,
    currency: normalizeCurrency(store.defaultCurrency!),
  }));
}
