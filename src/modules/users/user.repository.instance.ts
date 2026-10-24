import { prisma } from '../../config/database.js';

import { createUserRepository } from './user.repository.js';

export const userRepository = createUserRepository(prisma);
