import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export class WarehouseRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}
  list(tenantId: string) {
    return this.db.warehouse.findMany({
      where: { tenantId },
      include: { coverage: { select: { countryCode: true } } },
      orderBy: [{ priority: 'asc' }, { code: 'asc' }],
    });
  }
  find(tenantId: string, id: string) {
    return this.db.warehouse.findFirst({
      where: { tenantId, id },
      include: { coverage: { select: { countryCode: true } } },
    });
  }
  activeCountry(code: string) {
    return this.db.country.findFirst({
      where: { code, isActive: true },
      select: { code: true },
    });
  }
  async lockTenant(tenantId: string) {
    await this.db
      .$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
  }
  async lockWarehouse(tenantId: string, id: string) {
    await this.db
      .$queryRaw`SELECT "id" FROM "Warehouse" WHERE "tenantId"=${tenantId} AND "id"=${id} FOR UPDATE`;
  }
  async replaceCoverage(
    tenantId: string,
    warehouseId: string,
    countries: string[],
  ) {
    await this.db.warehouseCoverage.deleteMany({
      where: { tenantId, warehouseId },
    });
    return this.db.warehouseCoverage.createMany({
      data: countries.map((countryCode) => ({
        tenantId,
        warehouseId,
        countryCode,
      })),
      skipDuplicates: true,
    });
  }
  clearDefault(tenantId: string) {
    return this.db.warehouse.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }
  create(data: Prisma.WarehouseUncheckedCreateInput) {
    return this.db.warehouse.create({
      data,
      include: { coverage: { select: { countryCode: true } } },
    });
  }
  update(
    tenantId: string,
    id: string,
    data: Prisma.WarehouseUncheckedUpdateInput,
  ) {
    return this.db.warehouse.update({
      where: { tenantId_id: { tenantId, id } },
      data,
      include: { coverage: { select: { countryCode: true } } },
    });
  }
  // Until warehouse allocation is integrated, legacy tenant orders cannot safely
  // be attributed to a source. Treat all unresolved tenant orders conservatively.
  unresolvedOrder(tenantId: string, warehouseId: string) {
    return this.db.order.findFirst({
      where: {
        tenantId,
        OR: [{ warehouseId }, { warehouseId: null }],
        status: { notIn: ['CANCELLED', 'COMPLETED', 'DELIVERED'] },
      },
      select: { id: true },
    });
  }
  reservation(tenantId: string, warehouseId: string) {
    return this.db.inventory.findFirst({
      where: { tenantId, warehouseId, reservedQuantity: { gt: 0 } },
      select: { id: true },
    });
  }
}
