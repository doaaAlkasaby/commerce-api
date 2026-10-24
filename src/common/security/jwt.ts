import {
  SignJWT,
  jwtVerify,
  type JWTPayload,
} from 'jose';

import { env } from '../../config/env.js';

const secret = new TextEncoder().encode(
  env.JWT_ACCESS_SECRET,
);

export interface AccessTokenPayload
  extends JWTPayload {
  type: 'access';
}

export const createAccessToken = async (
  userId: string,
): Promise<string> => {
  return new SignJWT({
    type: 'access',
  })
    .setProtectedHeader({
      alg: 'HS256',
      typ: 'JWT',
    })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(
      env.JWT_ACCESS_EXPIRES_IN,
    )
    .sign(secret);
};

export const verifyAccessToken = async (
  token: string,
): Promise<AccessTokenPayload> => {
  const { payload } = await jwtVerify(
    token,
    secret,
    {
      algorithms: ['HS256'],
    },
  );

  if (payload.type !== 'access') {
    throw new Error(
      'Invalid access token type',
    );
  }

  return payload as AccessTokenPayload;
};