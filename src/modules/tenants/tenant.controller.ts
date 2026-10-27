import type { RequestHandler } from 'express';

import {
  addTenantMemberSchema,
  createTenantSchema,
  updateTenantMemberSchema,
  updateTenantSchema,
} from './tenant.schemas.js';

import { tenantService } from './tenant.service.instance.js';

import {
  mapTenant,
  mapTenantMember,
} from './tenant.mapper.js';
import type { Request, Response } from 'express';

import { UnauthorizedError } from '../../common/errors/unauthorized.error.js';
import { mapTenantMembership } from './tenant.mapper.js';



export const tenantController = {
  create: (async (req, res, next) => {
    try {
      const input =
        createTenantSchema.parse(req.body);

      const tenant =
        await tenantService.create(input);

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
      const tenant =
        await tenantService.getById(
          req.params.id,
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
      const input =
        updateTenantSchema.parse(req.body);

      const tenant =
        await tenantService.update(
          req.params.id,
          input,
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
      const body =
        addTenantMemberSchema.parse(
          req.body,
        );

      const member =
        await tenantService.addMember({
          tenantId: req.params.id,
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
      const members =
        await tenantService.listMembers(
          req.params.id,
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
      const input =
        updateTenantMemberSchema.parse(
          req.body,
        );

      const member =
        await tenantService.updateMember(
          req.params.id,
          req.params.userId,
          input,
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
      if (!req.user) throw new UnauthorizedError('Authentication is required');
      const memberships = await tenantService.listUserMemberships(req.user.userId);
      res.json({ success: true, message: null, data: memberships.map(mapTenantMembership) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler,
};
