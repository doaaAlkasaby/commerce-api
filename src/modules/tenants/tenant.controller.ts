import type { RequestHandler } from 'express';

import {
  addTenantMemberSchema,
  createTenantSchema,
  updateTenantMemberSchema,
  updateTenantSchema,
} from './tenant.schemas.js';

import { tenantService } from './tenant.service.instance.js';

import { mapTenant, mapTenantMember } from './tenant.mapper.js';

import { AppError } from '../../common/errors/app-error.js';
import { z } from 'zod';
import { mapTenantMembership } from './tenant.mapper.js';

export const tenantController = {
  create: (async (req, res, next) => {
    try {
      const input = createTenantSchema.parse(req.body);

      const tenant = await tenantService.create({
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
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.logoStorageKey !== undefined
          ? { logoStorageKey: input.logoStorageKey }
          : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      });

      res.status(201).json({
        success: true,
        message: 'Tenant created successfully.',
        data: mapTenant(tenant),
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,

  getById: (async (req, res, next) => {
    try {
      const tenant = await tenantService.getTenantById(
        z.string().parse(req.params.id),
      );

      res.json({
        success: true,
        message: null,
        data: mapTenant(tenant),
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,

  update: (async (req, res, next) => {
    try {
      const input = updateTenantSchema.parse(req.body);

      const tenant = await tenantService.update(
        z.string().parse(req.params.id),
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.legalName !== undefined
            ? { legalName: input.legalName }
            : {}),
          ...(input.defaultCountryCode !== undefined
            ? { defaultCountryCode: input.defaultCountryCode }
            : {}),
          ...(input.defaultCurrency !== undefined
            ? { defaultCurrency: input.defaultCurrency }
            : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.logoStorageKey !== undefined
            ? { logoStorageKey: input.logoStorageKey }
            : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        },
      );

      res.json({
        success: true,
        message: 'Tenant updated successfully.',
        data: mapTenant(tenant),
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,

  addMember: (async (req, res, next) => {
    try {
      const body = addTenantMemberSchema.parse(req.body);

      const member = await tenantService.addMember({
        tenantId: z.string().parse(req.params.id),
        userId: body.userId,
        role: body.role,
      });

      res.status(201).json({
        success: true,
        message: 'Tenant member added successfully.',
        data: mapTenantMember(member),
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,

  listMembers: (async (req, res, next) => {
    try {
      const members = await tenantService.listMembers(
        z.string().parse(req.params.id),
      );

      res.json({
        success: true,
        message: null,
        data: members.map(mapTenantMember),
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,

  updateMember: (async (req, res, next) => {
    try {
      const input = updateTenantMemberSchema.parse(req.body);

      const member = await tenantService.updateMember(
        z.string().parse(req.params.id),
        z.string().parse(req.params.userId),
        {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      );

      res.json({
        success: true,
        message: 'Tenant member updated successfully.',
        data: mapTenantMember(member),
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,

  getMyTenants: (async (req, res, next) => {
    try {
      if (!req.user)
        throw new AppError(
          'Authentication is required',
          401,
          'AUTHENTICATION_REQUIRED',
        );
      const memberships = await tenantService.listUserMemberships(
        req.user.userId,
      );
      res.json({
        success: true,
        message: null,
        data: memberships.map(mapTenantMembership),
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,
};
