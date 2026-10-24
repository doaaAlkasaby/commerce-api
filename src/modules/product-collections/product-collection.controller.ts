import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import type { ZodType } from 'zod';

import { AppError } from '../../common/errors/app-error.js';

import {
  addProductToCollectionSchema,
  collectionIdParamsSchema,
  collectionProductsQuerySchema,
  collectionProductParamsSchema,
  createProductCollectionSchema,
  updateCollectionProductOrderSchema,
  updateProductCollectionSchema,
} from './product-collection.schemas.js';

import { productCollectionService } from './product-collection.service.instance.js';

const parseRequestValue = <T>(
  value: unknown,
  schema: ZodType<T>,
  message: string,
): T => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError(
      message,
      400,
      'VALIDATION_ERROR',
    );
  }

  return result.data;
};

const getCollectionParams = (
  req: Request,
) =>
  parseRequestValue(
    req.validatedParams ?? req.params,
    collectionIdParamsSchema,
    'Invalid collection ID',
  );

const getCollectionProductParams = (
  req: Request,
) =>
  parseRequestValue(
    req.validatedParams ?? req.params,
    collectionProductParamsSchema,
    'Invalid collection or product ID',
  );

export const listCollections = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await productCollectionService.listCollections();

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await productCollectionService.getCollection(
        getCollectionParams(req).id,
      );

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getCollectionProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { page, limit } =
      parseRequestValue(
        req.validatedQuery ?? req.query,
        collectionProductsQuerySchema,
        'Invalid pagination query',
      );

    const data =
      await productCollectionService.getProducts(
        getCollectionParams(req).id,
        page,
        limit,
      );

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const createCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await productCollectionService.createCollection(
        parseRequestValue(
          req.validatedBody ?? req.body,
          createProductCollectionSchema,
          'Invalid collection data',
        ),
      );

    res.status(201).json({
      success: true,
      message: 'Collection created successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await productCollectionService.updateCollection(
        getCollectionParams(req).id,
        parseRequestValue(
          req.validatedBody ?? req.body,
          updateProductCollectionSchema,
          'Invalid collection data',
        ),
      );

    res.status(200).json({
      success: true,
      message: 'Collection updated successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await productCollectionService.deleteCollection(
      getCollectionParams(req).id,
    );

    res.status(200).json({
      success: true,
      message: 'Collection deleted successfully',
      data: null,
    });
  } catch (error) {
    next(error);
  }
};

export const addProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await productCollectionService.addProduct(
        getCollectionParams(req).id,
        parseRequestValue(
          req.validatedBody ?? req.body,
          addProductToCollectionSchema,
          'Invalid product data',
        ),
      );

    res.status(201).json({
      success: true,
      message: 'Product added to collection successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const removeProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const params =
      getCollectionProductParams(req);

    await productCollectionService.removeProduct(
      params.id,
      params.productId,
    );

    res.status(200).json({
      success: true,
      message: 'Product removed from collection successfully',
      data: null,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProductOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const params =
      getCollectionProductParams(req);

    const data =
      await productCollectionService.updateProductOrder(
        params.id,
        params.productId,
        parseRequestValue(
          req.validatedBody ?? req.body,
          updateCollectionProductOrderSchema,
          'Invalid product order',
        ),
      );

    res.status(200).json({
      success: true,
      message: 'Product order updated successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};