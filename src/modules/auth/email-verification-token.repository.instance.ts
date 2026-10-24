import { prisma } from '../../config/database.js';

import { createEmailVerificationTokenRepository } from "./email-verification-token.repository.js";

export const emailVerificationTokenRepository =
  createEmailVerificationTokenRepository(prisma);