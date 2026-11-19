import type { PrismaClient } from '../../generated/prisma/client.js';
import type {
  AddTenantMemberInput,
  CreateTenantInput,
  UpdateTenantInput,
  UpdateTenantMemberInput,
} from './tenant.types.js';

export class TenantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateTenantInput) {
    return this.prisma.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        code: input.code,
        ...(input.legalName !== undefined
          ? { legalName: input.legalName }
          : {}),
        ...(input.defaultCountryCode !== undefined
          ? { defaultCountryCode: input.defaultCountryCode }
          : {}),
        ...(input.defaultCurrency !== undefined
          ? { defaultCurrency: input.defaultCurrency }
          : {}),
        timezone: input.timezone ?? 'UTC',
        ...(input.logoStorageKey !== undefined
          ? { logoStorageKey: input.logoStorageKey }
          : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      },
    });
  }

  async findById(id: string) {
    return this.prisma.tenant.findUnique({
      where: { id },
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.tenant.findUnique({
      where: { slug },
    });
  }

  async findByCode(code: string) {
    return this.prisma.tenant.findUnique({
      where: { code },
    });
  }

  async update(id: string, input: UpdateTenantInput) {
    return this.prisma.tenant.update({
      where: { id },
      data: input,
    });
  }

  async addMember(input: AddTenantMemberInput) {
    return this.prisma.tenantMember.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        ...(input.role !== undefined ? { role: input.role } : {}),
      },
    });
  }

  async findMembership(tenantId: string, userId: string) {
    return this.prisma.tenantMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
    });
  }

  async updateMember(
    tenantId: string,
    userId: string,
    input: UpdateTenantMemberInput,
  ) {
    return this.prisma.tenantMember.update({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
      data: input,
    });
  }

  async listMembers(tenantId: string) {
    return this.prisma.tenantMember.findMany({
      where: {
        tenantId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isActive: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async listUserMemberships(userId: string) {
    return this.prisma.tenantMember.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        tenant: {
          status: 'ACTIVE',
        },
      },
      include: {
        tenant: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async listPublicStores() {
    return this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        isPubliclyListed: true,
        defaultCurrency: { not: null },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        coverImageUrl: true,
        defaultCurrency: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }
}
