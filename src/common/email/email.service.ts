import { logger } from '../logger/logger.js';

export interface SendVerificationEmailInput {
  email: string;
  firstName: string;
  verificationToken: string;
}

export interface SendPasswordResetEmailInput {
  email: string;
  firstName: string;
  resetToken: string;
}

export const createEmailService = () => {
  return {
    sendVerificationEmail: async (
      _input: SendVerificationEmailInput,
    ): Promise<void> => {
      /*
       * Email provider integration will be added later.
       *
       * Tokens and addresses are never written to logs.
       */

      logger.info(
        { category: 'EMAIL_DELIVERY_NOT_CONFIGURED' },
        'Verification delivery adapter is not configured',
      );
    },

    sendPasswordResetEmail: async (
      _input: SendPasswordResetEmailInput,
    ): Promise<void> => {
      logger.info(
        { category: 'EMAIL_DELIVERY_NOT_CONFIGURED' },
        'Password reset delivery adapter is not configured',
      );
    },
  };
};
