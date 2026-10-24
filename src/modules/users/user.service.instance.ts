import {
  userRepository,
} from './user.repository.instance.js';

import {
  createUserService,
} from './user.service.js';

export const userService =
  createUserService(
    userRepository,
  );