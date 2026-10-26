import { AppError } from '../../common/errors/app.error.js';

import type {
  AddTenantMemberInput,
  CreateTenantInput,
  UpdateTenantInput,
  UpdateTenantMemberInput,
} from './tenant.types.js';

import { TenantRepository } from './tenant.repository.js';

export class TenantService {
  constructor(
    private readonly repository: TenantRepository,
  ) {}

  async create(input: CreateTenantInput) {
    const existingSlug =
      await this.repository.findBySlug(input.slug);

    if (existingSlug) {
      throw new AppError(
        'Tenant slug already exists',
        409,
        'TENANT_SLUG_ALREADY_EXISTS',
      );
    }

    const existingCode =
      await this.repository.findByCode(input.code);

    if (existingCode) {
      throw new AppError(
        'Tenant code already exists',
        409,
        'TENANT_CODE_ALREADY_EXISTS',
      );
    }

    return this.repository.create(input);
  }

  async getTenantById(id: string) {
    const tenant = await this.repository.findById(id);

    if (!tenant) {
      throw new AppError(
        'Tenant not found',
        404,
        'TENANT_NOT_FOUND',
      );
    }

    return tenant;
  }

  async getTenantBySlug(slug: string) {
    const tenant =
      await this.repository.findBySlug(slug);

    if (!tenant) {
      throw new AppError(
        'Tenant not found',
        404,
        'TENANT_NOT_FOUND',
      );
    }

    return tenant;
  }

  async update(
    id: string,
    input: UpdateTenantInput,
  ) {
    await this.getTenantById(id);

    return this.repository.update(id, input);
  }

  async addMember(
    input: AddTenantMemberInput,
  ) {
    await this.getTenantById(input.tenantId);

    const existing =
      await this.repository.findMembership(
        input.tenantId,
        input.userId,
      );

    if (existing) {
      throw new AppError(
        'User is already a member of this tenant',
        409,
        'TENANT_MEMBER_ALREADY_EXISTS',
      );
    }

    return this.repository.addMember(input);
  }

  async getMembership(
    tenantId: string,
    userId: string,
  ) {
    return this.repository.findMembership(
      tenantId,
      userId,
    );
  }

  async updateMember(
    tenantId: string,
    userId: string,
    input: UpdateTenantMemberInput,
  ) {
    const membership =
      await this.repository.findMembership(
        tenantId,
        userId,
      );

    if (!membership) {
      throw new AppError(
        'Tenant membership not found',
        404,
        'TENANT_MEMBERSHIP_NOT_FOUND',
      );
    }

    return this.repository.updateMember(
      tenantId,
      userId,
      input,
    );
  }

  async listMembers(tenantId: string) {
    await this.getTenantById(tenantId);

    return this.repository.listMembers(tenantId);
  }

  async listUserMemberships(userId: string) {
    return this.repository.listUserMemberships(userId);
  }
}