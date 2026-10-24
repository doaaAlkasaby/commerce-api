import crypto from 'node:crypto';



export const generateTokenFamilyId = (): string => {
  return crypto.randomUUID();
};


export const generateSecureToken = (): string => {
  return crypto.randomBytes(32).toString('base64url');
};

export const generateRefreshToken = (): string => {
  return generateSecureToken();
};

export const hashToken = (
  token: string,
): string => {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
};