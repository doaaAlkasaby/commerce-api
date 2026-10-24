import { prisma } from '../../config/database.js';
import { WishlistRepository } from './wishlist.repository.js';

export const wishlistRepository =
  new WishlistRepository(prisma);