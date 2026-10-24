import { prisma } from '../../config/database.js';

import {
  createRefreshTokenRepository,
} from './refresh-token.repository.js';

export const refreshTokenRepository =
  createRefreshTokenRepository(prisma);