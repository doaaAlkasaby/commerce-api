import { prisma } from '../../config/database.js';

import { AppSettingRepository } from './app-setting.repository.js';

export const appSettingRepository = new AppSettingRepository(prisma);
