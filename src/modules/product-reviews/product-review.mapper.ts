import type { ProductReviewResponse } from './product-review.types.js';

export const mapProductReview = (review: {
  id: string;
  productId: string;
  rating: number;
  title: string | null;
  comment: string | null;
  isApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    firstName: string;
    lastName: string;
  };
}): ProductReviewResponse => ({
  id: review.id,
  productId: review.productId,

  user: {
    id: review.user.id,
    name: `${review.user.firstName} ${review.user.lastName}`.trim(),
  },

  rating: review.rating,
  title: review.title,
  comment: review.comment,
  isApproved: review.isApproved,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
});
