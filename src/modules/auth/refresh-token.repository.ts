
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

    create: async (data: {
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
    }) => {
      return db.refreshToken.create({
        data,
      });
    },

    revoke: async (
      tokenId: string,
      replacedByTokenId?: string,
    ) => {
      return db.refreshToken.update({
        where: {
          id: tokenId,
        },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: replacedByTokenId ?? null,
        },
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
        const createdToken = await tx.refreshToken.create({
          data: newToken,
        });

        await tx.refreshToken.update({
          where: {
            id: oldTokenId,
          },
          data: {
            revokedAt: new Date(),
            replacedByTokenId: createdToken.id,
          },
        });

        return createdToken;
      });
    },

    revokeAllForUser: async (
      userId: string,
    ) => {
      return db.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    },

    revokeFamily: async (
  familyId: string,
) => {
  return db.refreshToken.updateMany({
    where: {
      familyId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
},
  
   
  };
};
