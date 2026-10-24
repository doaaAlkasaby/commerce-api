import {
  userRepository,
} from '../users/user.repository.instance.js';

import {
  passwordResetTokenRepository,
} from './password-reset-token.repository.instance.js';

import {
  createPasswordResetService,
} from './password-reset.service.js';

export const passwordResetService =
  createPasswordResetService(
    userRepository,
    passwordResetTokenRepository,
  );