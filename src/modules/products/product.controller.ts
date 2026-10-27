import type { Request, Response } from 'express';

import { ProductStatus } from '../../generated/prisma/client.js';

import { productService } from './product.service.instance.js';

import type {
  CreateProductInput,
  ProductDiscountInput,
  UpdateProductInput,
} from './product.types.js';

import {
  productListQuerySchema,
  productListingQuerySchema,
  type ProductListQueryRequest,
  type ProductListingQuery,
} from './product.schemas.js';

const getProductId = (req: Request): string => {
  const { id } = req.validatedParams as { id: string };
  return id;
};

const getListingQuery = (req: Request): ProductListingQuery =>
  productListingQuerySchema.parse(req.validatedQuery ?? req.query);

const getProductListQuery = (req: Request): ProductListQueryRequest =>
  productListQuerySchema.parse(req.validatedQuery ?? req.query);

const normalizeDiscount = (
  discount: ProductDiscountInput | null,
): ProductDiscountInput | null => {
  if (discount === null) {
    return discount;
  }

  return {
    type: discount.type,
    value: discount.value,
    ...(discount.startsAt !== undefined ? { startsAt: discount.startsAt } : {}),
    ...(discount.endsAt !== undefined ? { endsAt: discount.endsAt } : {}),
  };
};

export const createProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = req.validatedBody as CreateProductInput;
  const product = await productService.create(req.tenant!.tenantId, {
    name: body.name,
    slug: body.slug,
    categoryId: body.categoryId,
    basePrice: body.basePrice,
    ...(body.description !== undefined
      ? { description: body.description }
      : {}),
    ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
    ...(body.discount !== undefined
      ? { discount: normalizeDiscount(body.discount) }
      : {}),
  });

  res.status(201).json({
    success: true,
    message: 'Product created successfully',
    data: product,
  });
};

export const updateProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = req.validatedBody as UpdateProductInput;
  const product = await productService.update(req.tenant!.tenantId, getProductId(req), {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.slug !== undefined ? { slug: body.slug } : {}),
    ...(body.description !== undefined
      ? { description: body.description }
      : {}),
    ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
    ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
    ...(body.basePrice !== undefined ? { basePrice: body.basePrice } : {}),
    ...(body.discount !== undefined
      ? { discount: normalizeDiscount(body.discount) }
      : {}),
  });

  res.json({
    success: true,
    message: 'Product updated successfully',
    data: product,
  });
};

export const getProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.userId;
  const product = await productService.getById(req.tenant!.tenantId, getProductId(req), userId);

  res.json({
    success: true,
    message: null,
    data: product,
  });
};

export const listProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.userId;
  const products = await productService.list(req.tenant!.tenantId, getProductListQuery(req), userId);

  res.json({
    success: true,
    message: null,
    data: products,
  });
};

export const changeProductStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = req.validatedBody as {
    status: ProductStatus;
  };

  const product = await productService.changeStatus(
    req.tenant!.tenantId,
    getProductId(req),
    body.status,
  );

  res.json({
    success: true,
    message: 'Product status updated successfully',
    data: product,
  });
};

export const deleteProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  await productService.delete(req.tenant!.tenantId, getProductId(req));

  res.status(204).send();
};

export const getOffers = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId;
  const { page, limit } = getListingQuery(req);
  const data = await productService.getOffers(req.tenant!.tenantId, page, limit, userId);

  res.status(200).json({
    success: true,
    message: null,
    data,
  });
};

export const getBestSellers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.userId;
  const { page, limit } = getListingQuery(req);
  const data = await productService.getBestSellers(req.tenant!.tenantId, page, limit, userId);

  res.status(200).json({
    success: true,
    message: null,
    data,
  });
};

export const getNewArrivals = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.userId;
  const { page, limit } = getListingQuery(req);
  const data = await productService.getNewArrivals(req.tenant!.tenantId, page, limit, userId);

  res.status(200).json({
    success: true,
    message: null,
    data,
  });
};
