import {
  AppError,
} from '../../common/errors/app-error.js';

import type {
  createUserRepository,
} from './user.repository.js';

import {
  toUserResponse,
} from './user.mapper.js';

import type {
  UpdateProfileInput,
} from './user.types.js';
import { prisma } from '../../config/database.js';

type UserRepository =
  ReturnType<
    typeof createUserRepository
  >;

export const createUserService = (
  userRepository: UserRepository,
) => {
  return {
    getProfile: async (
      userId: string,
    ) => {
      const user =
        await userRepository.findById(
          userId,
        );

      if (!user) {
        throw new AppError(
          'User not found',
          404,
          'USER_NOT_FOUND',
        );
      }

      return toUserResponse(user);
    },

    updateProfile: async (
      userId: string,
      data: UpdateProfileInput,
    ) => {
      const user =
        await userRepository.findById(
          userId,
        );

      if (!user) {
        throw new AppError(
          'User not found',
          404,
          'USER_NOT_FOUND',
        );
      }

      const updatedUser =
        await userRepository.updateProfile(
          userId,
          data,
        );

      return toUserResponse(updatedUser);
    },

updateStatus: async (
  userId: string,
  isActive: boolean,
) => {
  const user =
    await userRepository.findById(
      userId,
    );

  if (!user) {
    throw new AppError(
      'User not found',
      404,
      'USER_NOT_FOUND',
    );
  }

  const updatedUser =
    await userRepository.updateStatus(
      userId,
      isActive,
    );

  return toUserResponse(
    updatedUser,
  );
},
    updateDefaultCountry: async (userId: string, countryCode: string) => {
      const country = await prisma.country.findFirst({
        where: { code: countryCode, isActive: true },
        select: { code: true },
      });
      if (!country) {
        throw new AppError('COUNTRY_NOT_SUPPORTED', 'The selected country is not supported.', 400);
      }
      return userRepository.updateDefaultCountry(userId, countryCode);
    },
  };
};
