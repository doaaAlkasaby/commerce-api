import type { PrismaClient } from '../../generated/prisma/client.js';

import type { CreateUserInput, UpdateUserInput,
   UpdateProfileInput } from './user.types.js';

export const createUserRepository = (db: PrismaClient) => {
  return {
    findById: async (id: string) => {
      return db.user.findUnique({
        where: {
          id,
        },
      });
    },

    findByEmail: async (email: string) => {
      return db.user.findUnique({
        where: {
          email,
        },
      });
    },

    create: async (data: CreateUserInput) => {
      return db.user.create({
        data,
      });
    },

    update: async (id: string, data: UpdateUserInput) => {
      return db.user.update({
        where: {
          id,
        },
        data,
      });
    },
    updateProfile: async (
      id: string,
      data: UpdateProfileInput,
    ) => {
      return db.user.update({
        where: { id },
        data: {
          ...(data.firstName !== undefined
            ? { firstName: data.firstName }
            : {}),
          ...(data.lastName !== undefined
            ? { lastName: data.lastName }
            : {}),
        },
      });
    },

    delete: async (id: string) => {
      return db.user.delete({
        where: {
          id,
        },
      });
    },

    markEmailAsVerified: async (
      id: string,
    ) => {
      return db.user.update({
        where: {
          id,
        },
        data: {
          emailVerifiedAt: new Date(),
        },
      });
    },

    updateStatus: async (
      id: string,
      isActive: boolean,
    ) => {
      return db.user.update({
        where: {
          id,
        },
        data: {
          isActive,
        },
      });
    },


    updatePassword: async (
      id: string,
      passwordHash: string,
    ) => {
      return db.user.update({
        where: {
          id,
        },
        data: {
          passwordHash,
        },
      });
    },

    updateDefaultCountry: async (userId: string, countryCode: string) => {
      return db.user.update({
        where: { id: userId },
        data: { defaultCountryCode: countryCode },
        select: {
          id: true,
          defaultCountryCode: true,
          defaultCountry: { select: { code: true, name: true, currencyCode: true } },
        },
      });
    },
  };
};


