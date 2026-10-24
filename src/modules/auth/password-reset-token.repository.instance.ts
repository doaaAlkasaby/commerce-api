import {
  prisma,
} from '../../config/database.js';

import {
  createPasswordResetTokenRepository,
} from './password-reset-token.repository.js';

export const passwordResetTokenRepository =
  createPasswordResetTokenRepository(
    prisma,
  );