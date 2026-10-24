import { z } from 'zod';

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<
  typeof paginationQuerySchema
>;

export function calculateSkip(
  page: number,
  limit: number,
): number {
  return (page - 1) * limit;
}

export function createPagination(
  page: number,
  limit: number,
  total: number,
): PaginationResponse {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}