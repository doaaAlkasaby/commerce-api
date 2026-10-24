import { wishlistRepository } from './wishlist.repository.instance.js';
import { WishlistService } from './wishlist.service.js';

export const wishlistService =
  new WishlistService(
    wishlistRepository,
  );