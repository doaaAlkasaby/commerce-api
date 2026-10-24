

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
      input: SendVerificationEmailInput,
    ): Promise<void> => {
      /*
       * Email provider integration will be added later.
       *
       * For now we log the verification URL
       * during development.
       */

      const verificationUrl =
        `http://localhost:3000/api/v1/auth/verify-email?token=${encodeURIComponent(
          input.verificationToken,
        )}`;

      console.log(
        `Verification email for ${input.email}: ${verificationUrl}`,
      );
    },

    sendPasswordResetEmail: async (
      input: SendPasswordResetEmailInput,
    ): Promise<void> => {
      const resetUrl =
        `http://localhost:3000/reset-password?token=${encodeURIComponent(
          input.resetToken,
        )}`;

      console.log(
        `Password reset email for ${input.email}: ${resetUrl}`,
      );
    },


  };
};