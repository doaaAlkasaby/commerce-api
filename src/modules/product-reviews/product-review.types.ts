export interface ProductReviewResponse {
  id: string;
  productId: string;
  user: {
    id: string;
    name: string;
  };
  rating: number;
  title: string | null;
  comment: string | null;
  isApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductRatingSummary {
  average: number;
  count: number;
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

export interface ProductReviewListResponse {
  items: ProductReviewResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
