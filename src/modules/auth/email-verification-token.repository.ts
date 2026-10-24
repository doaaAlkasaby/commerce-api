import type {
  PrismaClient,
} from '../../generated/prisma/client.js';
import type {
  Prisma,
} from '../../generated/prisma/client.js';


export const createEmailVerificationTokenRepository = (
  db: PrismaClient,
) => {
  return {
    findByTokenHash: async (
      tokenHash: string,
    ) => {
      return db.emailVerificationToken.findUnique({
        where: {
          tokenHash,
        },
      });
    },

    create: async (data: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
    }) => {
      return db.emailVerificationToken.create({
        data,
      });
    },

    markAsUsed: async (
      id: string,
    ) => {
      return db.emailVerificationToken.update({
        where: {
          id,
        },
        data: {
          usedAt: new Date(),
        },
      });
    },

    invalidateForUser: async (
      userId: string,
    ) => {
      return db.emailVerificationToken.updateMany({
        where: {
          userId,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });
    },


markUserAndTokenAsVerified: async (
  tx: Prisma.TransactionClient,
  userId: string,
  tokenId: string,
) => {
  await tx.user.update({
    where: {
      id: userId,
    },
    data: {
      emailVerifiedAt: new Date(),
    },
  });

  await tx.emailVerificationToken.update({
    where: {
      id: tokenId,
    },
    data: {
      usedAt: new Date(),
    },
  });
},

  };
};