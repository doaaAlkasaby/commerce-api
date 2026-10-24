import type {
  Request,
  Response,
} from 'express';

import {
  toUserResponse,
} from '../users/user.mapper.js';

import {
  authService,
} from './auth.service.instance.js';

import type {
  LoginRequest,
  RegisterRequest,
  RefreshRequest,
  LogoutRequest,
} from './auth.schemas.js';

import {
  emailVerificationService,
} from './email-verification.service.instance.js';

import {
  passwordResetService,
} from './password-reset.service.instance.js';
import {
  AppError,
} from '../../common/errors/app-error.js';


export const authController = {
  register: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const input =
      req.body as RegisterRequest;

    const user =
      await authService.register(input);

    res.status(201).json({
      success: true,
      message:
        'Account created successfully',
      data: toUserResponse(user),
    });
  },

  login: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const input =
      req.body as LoginRequest;

    const result =
      await authService.login(input);

    res.status(200).json({
      success: true,
      message: null,
      data: {
        accessToken:
        result.accessToken,

        refreshToken:
          result.refreshToken,

        tokenType:
          result.tokenType,

        expiresIn:
          result.expiresIn,

        user:
          toUserResponse(
            result.user,
          ),
      },
    });
  },

  refresh: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const {
      refreshToken,
    } = req.body as RefreshRequest;

    const result =
      await authService.refresh(
        refreshToken,
      );

    res.status(200).json({
      success: true,
      message: null,
      data: result,
    });
  },

  logout: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const {
      refreshToken,
    } = req.body as LogoutRequest;

    await authService.logout(
      refreshToken,
    );

    res.status(200).json({
      success: true,
      message:
        'Logged out successfully',
      data: null,
    });
  },


  verifyEmail: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await emailVerificationService.verifyEmail(
      req.query.token as string,
    );

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: null,
    });
  },

  resendVerification: async (
  req: Request,
  res: Response,
): Promise<void> => {
  await emailVerificationService
    .resendVerification(
      req.body.email,
    );

  res.status(200).json({
    success: true,
    message:
      'If the account exists and is not verified, a verification email has been sent',
    data: null,
  });
},

forgotPassword: async (
  req: Request,
  res: Response,
): Promise<void> => {
  await passwordResetService.forgotPassword(
    req.body.email,
  );

  res.status(200).json({
    success: true,
    message:
      'If the account exists, a password reset email has been sent',
    data: null,
  });
},

resetPassword: async (
  req: Request,
  res: Response,
): Promise<void> => {
  await passwordResetService.resetPassword(
    req.body.token,
    req.body.newPassword,
  );

  res.status(200).json({
    success: true,
    message:
      'Password reset successfully',
    data: null,
  });
},

changePassword: async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId =
    req.user?.userId;

  if (!userId) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  await authService.changePassword(
    userId,
    req.body.currentPassword,
    req.body.newPassword,
  );

  res.status(200).json({
    success: true,
    message:
      'Password changed successfully',
    data: null,
  });
},

logoutAll: async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId =
    req.user?.userId;

  if (!userId) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  await authService.logoutAll(
    userId,
  );

  res.status(200).json({
    success: true,
    message:
      'All sessions have been revoked',
    data: null,
  });
},

};



