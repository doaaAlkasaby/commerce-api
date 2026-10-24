import {
  generateRefreshToken,
  generateTokenFamilyId,
  hashToken,
} from './token.js';

import { env } from '../../config/env.js';

export const createRefreshTokenData = (
  userId: string,
  familyId?: string,
) => {
  const rawToken = generateRefreshToken();

  const tokenHash = hashToken(
    rawToken,
  );

  const expiresAt = new Date();

  expiresAt.setDate(
    expiresAt.getDate() +
      env.REFRESH_TOKEN_EXPIRES_DAYS,
  );

  return {
    rawToken,
    userId,
    tokenHash,
    familyId:
      familyId ??
      generateTokenFamilyId(),
    expiresAt,
  };
};