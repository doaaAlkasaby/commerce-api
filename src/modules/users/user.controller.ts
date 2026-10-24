import type {
  Request,
  Response,
} from 'express';

import {
  userService,
} from './user.service.instance.js';

import {
  updateProfileSchema,
} from './user.schemas.js';

export const userController = {
  profile: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId =
      req.user?.userId;

    if (!userId) {
      throw new Error(
        'Authenticated user is missing',
      );
    }

    const user =
      await userService.getProfile(
        userId,
      );

    res.status(200).json({
      success: true,
      message: null,
      data: user,
    });
  },

  updateProfile: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId =
      req.user?.userId;

    if (!userId) {
      throw new Error(
        'Authenticated user is missing',
      );
    }

    const user =
      await userService.updateProfile(
        userId,
        updateProfileSchema.parse(
          req.body,
        ),
      );

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user,
    });
  },

  updateStatus: async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId =
      req.user?.userId;

    if (!userId) {
      throw new Error(
        'Authenticated user is missing',
      );
    }

  const user =
    await userService.updateStatus(
      userId, //  req.params.id,
      req.body.isActive,
    );

  res.status(200).json({
    success: true,
    message:
      'User account status updated successfully',
    data: user,
  });
},


};