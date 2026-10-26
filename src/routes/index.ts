import { Router } from 'express';

import { env } from '../config/env.js';

import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import adminTestRoutes from '../modules/users/admin-test.routes.js';
import healthRoutes from './health.routes.js';
import verifiedTestRoutes from '../modules/users/verified-test.routes.js';
import categoryRoutes from '../modules/categories/category.routes.js';
import brandRoutes from '../modules/brands/brand.routes.js';
import productRoutes from '../modules/products/product.routes.js';
import productImageRoutes from '../modules/product-images/product-image.routes.js';
import inventoryRoutes from '../modules/inventory/inventory.routes.js';
import cartRoutes from '../modules/cart/cart.routes.js';
import productVariantRoutes from '../modules/product-variants/product-variant.routes.js';
import productAttributeRoutes from '../modules/product-attributes/product-attribute.routes.js';
import productVariantImageRoutes from '../modules/product-variant-images/product-variant-image.routes.js';
import productCollectionRoutes from '../modules/product-collections/product-collection.routes.js';
import wishlistRoutes from '../modules/wishlist/wishlist.routes.js';
import bannerRoutes from '../modules/banners/banner.routes.js';
import addressRoutes from '../modules/addresses/address.routes.js';
import { couponRouter } from '../modules/coupons/coupon.routes.js';
import paymentRoutes from '../modules/payments/payment.routes.js';
import checkoutRoutes from '../modules/checkout/checkout.routes.js';
import orderRoutes from '../modules/orders/order.routes.js';
import homeRoutes from '../modules/home/home.routes.js';
import { appSettingRouter } from '../modules/app-settings/app-setting.routes.js';
import { productReviewRouter } from '../modules/product-reviews/product-review.routes.js';
import deviceRouter
  from '../modules/devices/device.routes.js';

import notificationRouter
  from '../modules/notifications/notification.routes.js';

import { commerceContextMiddleware } from '../middleware/commerce-context.middleware.js';
import countryRoutes from '../modules/countries/country.routes.js';
import { tenantRoutes } from '../modules/tenants/tenant.routes.js';




const router = Router();

router.use(healthRoutes);

router.use('/countries', countryRoutes);

/*
 * Authentication
 *
 * POST /api/v1/auth/register
 * POST /api/v1/auth/login
 * POST /api/v1/auth/refresh
 * POST /api/v1/auth/logout
 */
router.use('/auth', authRoutes);

/*
 * Users
 *
 * GET   /api/v1/users/me
 * PATCH /api/v1/users/me
 */
router.use('/users', userRoutes);

/*
 * Temporary RBAC test route
 *
 * GET /api/v1/users/admin-test
 *
 * This route is only for verifying
 * authentication + authorization.
 *
 * We will remove it later when the
 * real admin module is implemented.
 */
router.use('/users', adminTestRoutes);

router.use('/users', verifiedTestRoutes);

router.use('/categories', categoryRoutes);

router.use('/brands', brandRoutes);

router.use('/products', commerceContextMiddleware, productRoutes);

router.use('/product-images', productImageRoutes);

router.use('/inventory', inventoryRoutes);

router.use('/cart', commerceContextMiddleware, cartRoutes);

router.use('/',productReviewRouter,);

router.use('/product-variants', commerceContextMiddleware, productVariantRoutes);
router.use('/product-attributes', productAttributeRoutes);
router.use('/product-variant-images', productVariantImageRoutes);

router.use('/home', commerceContextMiddleware, homeRoutes);

router.use('/collections', commerceContextMiddleware, productCollectionRoutes);

router.use('/wishlist', commerceContextMiddleware, wishlistRoutes);

router.use('/banners', bannerRoutes);

router.use(`/addresses`, addressRoutes);

router.use('/coupons', commerceContextMiddleware, couponRouter);

router.use('/payments', paymentRoutes);

router.use('/checkout', commerceContextMiddleware, checkoutRoutes);

router.use('/orders', orderRoutes);
router.use(
  '/app-settings',
  appSettingRouter,
);
router.use('/devices', deviceRouter);

router.use('/notifications', notificationRouter);

router.use(
  '/tenants',
  tenantRoutes,
);


export default router;
