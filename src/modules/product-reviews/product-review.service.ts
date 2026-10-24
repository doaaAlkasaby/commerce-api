import { Prisma } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

import { mapProductReview } from './product-review.mapper.js';

import type {
  CreateProductReviewRequest,
  ProductReviewListQuery,
  UpdateProductReviewRequest,
} from './product-review.schemas.js';

import type {
  ProductReviewListResponse,
  ProductRatingSummary,
} from './product-review.types.js';

import { productReviewRepository } from './product-review.repository.instance.js';
import { productRepository } from '../products/product.repository.instance.js';

export class ProductReviewService {
  async createReview(
    productId: string,
    userId: string,
    input: CreateProductReviewRequest,
  ) {
    // 1. Verify product exists
    const product = await productRepository.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    // 2. Verify purchase
    const hasPurchased = await productReviewRepository.hasPurchasedProduct(
      productId,
      userId,
    );

    if (!hasPurchased) {
      throw new AppError(
        'You can only review products you have purchased',
        403,
        'PRODUCT_PURCHASE_REQUIRED',
      );
    }

    // 3. Prevent duplicate review
    const existingReview = await productReviewRepository.findUserReview(
      productId,
      userId,
    );

    if (existingReview) {
      throw new AppError(
        'You have already reviewed this product',
        409,
        'REVIEW_ALREADY_EXISTS',
      );
    }

    // 4. Create review
    let review;
    try {
      review = await productReviewRepository.create({
        productId,
        userId,
        rating: input.rating,
        title: input.title ?? null,
        comment: input.comment ?? null,
        isApproved: true,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'You have already reviewed this product',
          409,
          'REVIEW_ALREADY_EXISTS',
        );
      }

      throw error;
    }

    // 5. Return created review
    const reviewWithUser = await productReviewRepository.findByIdWithUser(
      review.id,
    );

    if (!reviewWithUser) {
      throw new AppError(
        'Failed to retrieve created review',
        500,
        'REVIEW_RETRIEVAL_FAILED',
      );
    }

    return mapProductReview(reviewWithUser);
  }

  async updateReview(
    productId: string,
    reviewId: string,
    userId: string,
    input: UpdateProductReviewRequest,
  ) {
    // 1. Find review
    const review = await productReviewRepository.findById(reviewId);

    if (!review) {
      throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
    }

    // 2. Make sure review belongs to this product
    if (review.productId !== productId) {
      throw new AppError(
        'Review does not belong to this product',
        400,
        'REVIEW_PRODUCT_MISMATCH',
      );
    }

    // 3. Make sure current user owns the review
    if (review.userId !== userId) {
      throw new AppError(
        'You can only update your own review',
        403,
        'REVIEW_ACCESS_DENIED',
      );
    }

    // 4. Update
    try {
      await productReviewRepository.update(reviewId, {
        ...(input.rating !== undefined ? { rating: input.rating } : {}),

        ...(input.title !== undefined ? { title: input.title } : {}),

        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
      }

      throw error;
    }

    // 5. Return updated review
    const updatedReview =
      await productReviewRepository.findByIdWithUser(reviewId);

    if (!updatedReview) {
      throw new AppError(
        'Failed to retrieve updated review',
        500,
        'REVIEW_RETRIEVAL_FAILED',
      );
    }

    return mapProductReview(updatedReview);
  }

  async deleteReview(productId: string, reviewId: string, userId: string) {
    const review = await productReviewRepository.findById(reviewId);

    if (!review) {
      throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
    }

    if (review.productId !== productId) {
      throw new AppError(
        'Review does not belong to this product',
        400,
        'REVIEW_PRODUCT_MISMATCH',
      );
    }

    if (review.userId !== userId) {
      throw new AppError(
        'You can only delete your own review',
        403,
        'REVIEW_ACCESS_DENIED',
      );
    }

    try {
      await productReviewRepository.delete(reviewId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
      }

      throw error;
    }

    return null;
  }

  async getProductReviews(
    productId: string,
    query: ProductReviewListQuery,
  ): Promise<ProductReviewListResponse> {
    // Verify product exists
    const product = await productRepository.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      productReviewRepository.findProductReviews(productId, skip, limit),
      productReviewRepository.countProductReviews(productId),
    ]);

    return {
      items: reviews.map(mapProductReview),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getRatingSummary(productId: string): Promise<ProductRatingSummary> {
    const product = await productRepository.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const summary = await productReviewRepository.getRatingSummary(productId);

    return {
      average:
        summary.count === 0
          ? 0
          : Number((summary.totalRating / summary.count).toFixed(2)),
      count: summary.count,
      distribution: summary.distribution,
    };
  }
}

export const productReviewService = new ProductReviewService();
