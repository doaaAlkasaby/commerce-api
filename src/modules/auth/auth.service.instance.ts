import {
  userRepository,
} from '../users/user.repository.instance.js';

import {
  refreshTokenRepository,
} from './refresh-token.repository.instance.js';

import {
  createAuthService,
} from './auth.service.js';

import {
  emailVerificationService,
} from './email-verification.service.instance.js';


export const authService =
  createAuthService(
    userRepository,
    refreshTokenRepository,
        emailVerificationService,

  );