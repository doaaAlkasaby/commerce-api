import { logger } from '../logger/logger.js';
import { writeDevelopmentEmail } from './development-outbox.js';

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

export const createEmailService = (
  options: {
    mode: 'disabled' | 'development_file';
    nodeEnv: string;
    outboxDirectory?: string | undefined;
    uploadDirectory?: string;
  } = { mode: 'disabled', nodeEnv: 'development' },
) => {
  if (
    options.mode === 'development_file' &&
    (options.nodeEnv === 'production' || !options.outboxDirectory)
  )
    throw new Error(
      'Development email is forbidden in production and requires an outbox path',
    );
  return {
    sendVerificationEmail: async (
      input: SendVerificationEmailInput,
    ): Promise<void> => {
      if (options.mode === 'development_file' && options.outboxDirectory) {
        await writeDevelopmentEmail(
          options.outboxDirectory,
          options.uploadDirectory ?? './uploads',
          { type: 'verification', ...input },
        );
        return;
      }
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
      input: SendPasswordResetEmailInput,
    ): Promise<void> => {
      if (options.mode === 'development_file' && options.outboxDirectory) {
        await writeDevelopmentEmail(
          options.outboxDirectory,
          options.uploadDirectory ?? './uploads',
          { type: 'password-reset', ...input },
        );
        return;
      }
      logger.info(
        { category: 'EMAIL_DELIVERY_NOT_CONFIGURED' },
        'Password reset delivery adapter is not configured',
      );
    },
  };
};
