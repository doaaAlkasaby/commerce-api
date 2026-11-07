import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { env } from '../../config/env.js';

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenPayload extends JWTPayload {
  type: 'access';
}

export const createAccessToken = async (userId: string): Promise<string> => {
  const jwt = new SignJWT({
    type: 'access',
  })
    .setProtectedHeader({
      alg: 'HS256',
      typ: 'JWT',
    })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN);
  if (env.JWT_ISSUER) jwt.setIssuer(env.JWT_ISSUER);
  if (env.JWT_AUDIENCE) jwt.setAudience(env.JWT_AUDIENCE);
  return jwt.sign(secret);
};

export const verifyAccessToken = async (
  token: string,
): Promise<AccessTokenPayload> => {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
    requiredClaims: ['sub', 'exp', 'iat'],
    ...(env.JWT_ISSUER ? { issuer: env.JWT_ISSUER } : {}),
    ...(env.JWT_AUDIENCE ? { audience: env.JWT_AUDIENCE } : {}),
  });

  if (
    payload.type !== 'access' ||
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    payload.sub.length > 128
  ) {
    throw new Error('Invalid access token type');
  }

  return { ...payload, type: 'access' };
};
