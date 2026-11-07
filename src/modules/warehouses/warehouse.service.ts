import { prisma } from '../../config/database.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma, Warehouse } from '../../generated/prisma/client.js';
import { WarehouseRepository } from './warehouse.repository.js';
import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from './warehouse.schemas.js';

export const mapWarehouse = (
  row: Warehouse & { coverage?: Array<{ countryCode: string }> },
) => ({
  id: row.id,
  tenantId: row.tenantId,
  code: row.code,
  name: row.name,
  description: row.description,
  countryCode: row.countryCode,
  region: row.region,
  city: row.city,
  address: row.address,
  isActive: row.isActive,
  isDefault: row.isDefault,
  priority: row.priority,
  countries: row.coverage?.map((item) => item.countryCode).sort() ?? [],
  latitude: row.latitude?.toNumber() ?? null,
  longitude: row.longitude?.toNumber() ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class WarehouseService {
  constructor(private readonly repository = new WarehouseRepository(prisma)) {}
  async list(tenantId: string) {
    return (await this.repository.list(tenantId)).map(mapWarehouse);
  }
  async get(tenantId: string, id: string) {
    const row = await this.repository.find(tenantId, id);
    if (!row)
      throw new AppError('Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND');
    return mapWarehouse(row);
  }
  async save(
    tenantId: string,
    input: CreateWarehouseInput | UpdateWarehouseInput,
    id?: string,
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        const repository = new WarehouseRepository(tx);
        await repository.lockTenant(tenantId);
        if (id) await repository.lockWarehouse(tenantId, id);
        const previous = id ? await repository.find(tenantId, id) : null;
        if (id && !previous)
          throw new AppError('Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND');
        const countryCode = input.countryCode ?? previous?.countryCode;
        if (!countryCode || !(await repository.activeCountry(countryCode)))
          throw new AppError(
            'Country is not supported',
            400,
            'COUNTRY_NOT_SUPPORTED',
          );
        const latitude =
          input.latitude !== undefined ? input.latitude : previous?.latitude;
        const longitude =
          input.longitude !== undefined ? input.longitude : previous?.longitude;
        if ((latitude != null) !== (longitude != null))
          throw new AppError(
            'Both coordinates are required together',
            400,
            'WAREHOUSE_COORDINATES_INCOMPLETE',
          );
        const active = input.isActive ?? previous?.isActive ?? true;
        const isDefault = input.isDefault ?? previous?.isDefault ?? false;
        if (isDefault && !active)
          throw new AppError(
            'Default warehouse must be active',
            409,
            'WAREHOUSE_DEFAULT_INACTIVE',
          );
        if (
          previous &&
          (!active ||
            [
              'countryCode',
              'city',
              'address',
              'region',
              'latitude',
              'longitude',
            ].some((key) => key in input)) &&
          ((await repository.unresolvedOrder(tenantId, previous.id)) ||
            (await repository.reservation(tenantId, previous.id)))
        )
          throw new AppError(
            'Warehouse has unresolved fulfillment obligations',
            409,
            'WAREHOUSE_IN_USE',
          );
        if (isDefault) await repository.clearDefault(tenantId);
        const fields = {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.countryCode !== undefined
            ? { countryCode: input.countryCode }
            : {}),
          ...(input.region !== undefined ? { region: input.region } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined
            ? { longitude: input.longitude }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          isDefault,
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
        } satisfies Prisma.WarehouseUncheckedUpdateInput;
        if (id)
          return mapWarehouse(await repository.update(tenantId, id, fields));
        if (!input.code || !input.name || !input.city || !input.address)
          throw new AppError(
            'Warehouse fields are required',
            400,
            'WAREHOUSE_FIELDS_REQUIRED',
          );
        return mapWarehouse(
          await repository.create({
            ...fields,
            tenantId,
            countryCode,
            code: input.code,
            name: input.name,
            city: input.city,
            address: input.address,
          }),
        );
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new AppError(
          'Warehouse code or default already exists',
          409,
          'WAREHOUSE_CONFLICT',
        );
      throw error;
    }
  }
  async coverage(tenantId: string, id: string, countries: string[]) {
    await prisma.$transaction(async (tx) => {
      const repository = new WarehouseRepository(tx);
      await repository.lockTenant(tenantId);
      await repository.lockWarehouse(tenantId, id);
      if (!(await repository.find(tenantId, id)))
        throw new AppError('Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND');
      if (
        (await repository.unresolvedOrder(tenantId, id)) ||
        (await repository.reservation(tenantId, id))
      )
        throw new AppError(
          'Warehouse has unresolved fulfillment obligations',
          409,
          'WAREHOUSE_IN_USE',
        );
      for (const code of countries)
        if (!(await repository.activeCountry(code)))
          throw new AppError(
            'Country is not supported',
            400,
            'COUNTRY_NOT_SUPPORTED',
          );
      await repository.replaceCoverage(tenantId, id, countries);
    });
    return { warehouseId: id, countries };
  }
}
