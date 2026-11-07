import { AppError } from '../../common/errors/app-error.js';

import type { PrismaClient } from '../../generated/prisma/client.js';

export const createRefreshTokenRepository = (db: PrismaClient) => {
  return {
    findByTokenHash: async (tokenHash: string) => {
      return db.refreshToken.findUnique({
        where: {
          tokenHash,
        },
        include: {
          user: true,
        },
      });
    },

    create: async (
      data: {
        userId: string;
        tokenHash: string;
        familyId: string;
        expiresAt: Date;
      },
      expectedPasswordHash?: string,
    ) => {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${data.userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: data.userId } });
        if (
          !user?.isActive ||
          (expectedPasswordHash !== undefined &&
            user.passwordHash !== expectedPasswordHash)
        )
          throw new AppError(
            'Invalid email or password',
            401,
            'INVALID_CREDENTIALS',
          );
        return tx.refreshToken.create({ data });
      });
    },

    revoke: async (tokenId: string, replacedByTokenId?: string) => {
      return db.$transaction(async (tx) => {
        const token = await tx.refreshToken.findUniqueOrThrow({
          where: { id: tokenId },
        });
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${token.userId} FOR UPDATE`;
        await tx.refreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return tx.refreshToken.update({
          where: { id: tokenId },
          data: {
            ...(replacedByTokenId === undefined ? {} : { replacedByTokenId }),
          },
        });
      });
    },

    rotate: async (
      oldTokenId: string,
      newToken: {
        userId: string;
        tokenHash: string;
        familyId: string;
        expiresAt: Date;
      },
    ) => {
      return db.$transaction(async (tx) => {
        // Serialize family rotation with logout/password changes on the owning user.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${newToken.userId} FOR UPDATE`;
        const old = await tx.refreshToken.findUnique({
          where: { id: oldTokenId },
        });
        if (
          !old ||
          old.userId !== newToken.userId ||
          old.revokedAt ||
          old.expiresAt <= new Date()
        ) {
          if (old)
            await tx.refreshToken.updateMany({
              where: { familyId: old.familyId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          return null;
        }
        const createdToken = await tx.refreshToken.create({ data: newToken });
        await tx.refreshToken.update({
          where: { id: oldTokenId },
          data: { revokedAt: new Date(), replacedByTokenId: createdToken.id },
        });
        return createdToken;
      });
    },

    revokeAllForUser: async (userId: string) => {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
        return tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
    },

    revokeFamily: async (familyId: string) => {
      return db.$transaction(async (tx) => {
        const token = await tx.refreshToken.findFirst({ where: { familyId } });
        if (!token) return { count: 0 };
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${token.userId} FOR UPDATE`;
        return tx.refreshToken.updateMany({
          where: { familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
    },
  };
};
