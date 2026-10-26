import { prisma } from '../../config/database.js';
import { DeviceRepository } from './device.repository.js';

export const deviceRepository =
  new DeviceRepository(prisma);