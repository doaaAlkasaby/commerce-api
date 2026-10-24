import { z } from 'zod';

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address'),

  password: z
    .string()
    .min(
      8,
      'Password must contain at least 8 characters',
    )
    .max(
      128,
      'Password must not exceed 128 characters',
    )
    .regex(
      /[A-Z]/,
      'Password must contain at least one uppercase letter',
    )
    .regex(
      /[a-z]/,
      'Password must contain at least one lowercase letter',
    )
    .regex(
      /[0-9]/,
      'Password must contain at least one number',
    )
    .regex(
      /[^A-Za-z0-9]/,
      'Password must contain at least one special character',
    ),

  firstName: z
    .string()
    .trim()
    .min(
      1,
      'First name is required',
    )
    .max(
      100,
      'First name must not exceed 100 characters',
    ),

  lastName: z
    .string()
    .trim()
    .min(
      1,
      'Last name is required',
    )
    .max(
      100,
      'Last name must not exceed 100 characters',
    ),
});


export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address'),

  password: z
    .string()
    .min(
      1,
      'Password is required',
    ),
});


export const refreshSchema = z.object({ refreshToken: z .string() .min(1, 'Refresh token is required'), });


export const logoutSchema = z.object({
  refreshToken: z
    .string()
    .min(1, 'Refresh token is required'),
});

export const verifyEmailSchema = z.object({
  token: z
    .string()
    .min(1, 'Verification token is required'),
});

export const resendVerificationSchema =
  z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Invalid email address'),
  });

export type RegisterRequest = z.infer<
  typeof registerSchema
>;

export type LoginRequest =
  z.infer<typeof loginSchema>;

export type RefreshRequest = z.infer<typeof refreshSchema>;

export type LogoutRequest =
  z.infer<typeof logoutSchema>;



export type VerifyEmailRequest =
  z.infer<typeof verifyEmailSchema>;

export type ResendVerificationRequest =
  z.infer<
    typeof resendVerificationSchema
  >;

  export const forgotPasswordSchema =
  z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Invalid email address'),
  });

export const resetPasswordSchema =
  z.object({
    token: z
      .string()
      .min(1, 'Reset token is required'),

    newPassword: z
      .string()
      .min(
        8,
        'Password must contain at least 8 characters',
      )
      .max(
        128,
        'Password must not exceed 128 characters',
      )
      .regex(
        /[A-Z]/,
        'Password must contain at least one uppercase letter',
      )
      .regex(
        /[a-z]/,
        'Password must contain at least one lowercase letter',
      )
      .regex(
        /[0-9]/,
        'Password must contain at least one number',
      )
      .regex(
        /[^A-Za-z0-9]/,
        'Password must contain at least one special character',
      ),
  });

  export type ForgotPasswordRequest =
  z.infer<typeof forgotPasswordSchema>;

export type ResetPasswordRequest =
  z.infer<typeof resetPasswordSchema>;

  export const changePasswordSchema =
  z.object({
    currentPassword: z
      .string()
      .min(1, 'Current password is required'),

    newPassword: z
      .string()
      .min(
        8,
        'Password must contain at least 8 characters',
      )
      .max(
        128,
        'Password must not exceed 128 characters',
      )
      .regex(
        /[A-Z]/,
        'Password must contain at least one uppercase letter',
      )
      .regex(
        /[a-z]/,
        'Password must contain at least one lowercase letter',
      )
      .regex(
        /[0-9]/,
        'Password must contain at least one number',
      )
      .regex(
        /[^A-Za-z0-9]/,
        'Password must contain at least one special character',
      ),
  })
  .refine(
    (data) =>
      data.currentPassword !==
      data.newPassword,
    {
      message:
        'New password must be different from current password',
      path: ['newPassword'],
    },
  );

  export type ChangePasswordRequest =
  z.infer<
    typeof changePasswordSchema
  >;