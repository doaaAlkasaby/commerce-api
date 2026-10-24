import {
  userRepository,
} from '../users/user.repository.instance.js';

import {
  emailVerificationTokenRepository,
} from './email-verification-token.repository.instance.js';

import {
  createEmailVerificationService,
} from './email-verification.service.js';

export const emailVerificationService =
  createEmailVerificationService(
    userRepository,
    emailVerificationTokenRepository,
  );