import { AppError } from '../../common/errors/app-error.js';

import type {
  CreateProductAttributeInput,
  CreateProductAttributeValueInput,
  UpdateProductAttributeInput,
  UpdateProductAttributeValueInput,
} from './product-attribute.types.js';

import {
  toProductAttributeResponse,
  toProductAttributeValueResponse,
} from './product-attribute.mapper.js';

import type { ProductAttributeRepository } from './product-attribute.repository.js';

import type { ProductRepository } from '../products/product.repository.js';

const isPrismaUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

export class ProductAttributeService {
  constructor(
    private readonly repository: ProductAttributeRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  // --------------------------------------------------
  // ATTRIBUTES
  // --------------------------------------------------

  async createAttribute(tenantId: string, input: CreateProductAttributeInput) {
    const product = await this.productRepository.findById(input.productId, tenantId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const name = input.name.trim();

    const existing = await this.repository.findByProductAndName(
      tenantId,
      input.productId,
      name,
    );

    if (existing) {
      throw new AppError(
        'An attribute with this name already exists for this product',
        409,
        'DUPLICATE_PRODUCT_ATTRIBUTE',
      );
    }

    try {
      const attribute = await this.repository.create(tenantId, {
        productId: input.productId,
        name,
        sortOrder: input.sortOrder ?? 0,
      });
      if (!attribute) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

      return toProductAttributeResponse(attribute);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'An attribute with this name already exists for this product',
          409,
          'DUPLICATE_PRODUCT_ATTRIBUTE',
        );
      }

      throw error;
    }
  }

  async getAttributeById(tenantId: string, id: string) {
    const attribute = await this.repository.findById(tenantId, id);

    if (!attribute) {
      throw new AppError(
        'Product attribute not found',
        404,
        'PRODUCT_ATTRIBUTE_NOT_FOUND',
      );
    }

    return toProductAttributeResponse(attribute);
  }

  async getAttributesByProduct(tenantId: string, productId: string) {
    const product = await this.productRepository.findById(productId, tenantId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const attributes = await this.repository.findByProductId(tenantId, productId);

    return attributes.map(toProductAttributeResponse);
  }

  async updateAttribute(tenantId: string, id: string, input: UpdateProductAttributeInput) {
    const attribute = await this.repository.findById(tenantId, id);

    if (!attribute) {
      throw new AppError(
        'Product attribute not found',
        404,
        'PRODUCT_ATTRIBUTE_NOT_FOUND',
      );
    }

    const name = input.name !== undefined ? input.name.trim() : undefined;

    if (name !== undefined && name !== attribute.name) {
      const duplicate = await this.repository.findByProductAndName(
        tenantId,
        attribute.productId,
        name,
      );

      if (duplicate && duplicate.id !== id) {
        throw new AppError(
          'An attribute with this name already exists for this product',
          409,
          'DUPLICATE_PRODUCT_ATTRIBUTE',
        );
      }
    }

    try {
      const updated = await this.repository.update(tenantId, id, {
        ...(name !== undefined ? { name } : {}),
        ...(input.sortOrder !== undefined
          ? { sortOrder: input.sortOrder }
          : {}),
      });
      if (!updated) throw new AppError('Product attribute not found', 404, 'PRODUCT_ATTRIBUTE_NOT_FOUND');

      return toProductAttributeResponse(updated);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'An attribute with this name already exists for this product',
          409,
          'DUPLICATE_PRODUCT_ATTRIBUTE',
        );
      }

      throw error;
    }
  }

  async deleteAttribute(tenantId: string, id: string) {
    const attribute = await this.repository.findById(tenantId, id);

    if (!attribute) {
      throw new AppError(
        'Product attribute not found',
        404,
        'PRODUCT_ATTRIBUTE_NOT_FOUND',
      );
    }

    /*
     * If variants use any of this attribute's values,
     * deleting the attribute would delete those values
     * because of Cascade.
     *
     * That would effectively destroy variant definitions.
     *
     * Therefore we explicitly reject the operation.
     */

    for (const value of attribute.values) {
      const count = await this.repository.countVariantsUsingAttributeValue(
        tenantId,
        value.id,
      );

      if (count > 0) {
        throw new AppError(
          'Cannot delete an attribute that is used by product variants',
          409,
          'ATTRIBUTE_IN_USE',
        );
      }
    }

    await this.repository.delete(tenantId, id);
  }

  // --------------------------------------------------
  // ATTRIBUTE VALUES
  // --------------------------------------------------

  async createValue(tenantId: string, input: CreateProductAttributeValueInput) {
    const attribute = await this.repository.findById(tenantId, input.attributeId);

    if (!attribute) {
      throw new AppError(
        'Product attribute not found',
        404,
        'PRODUCT_ATTRIBUTE_NOT_FOUND',
      );
    }

    const value = input.value.trim();

    const existing = await this.repository.findValueByAttributeAndValue(
      tenantId,
      input.attributeId,
      value,
    );

    if (existing) {
      throw new AppError(
        'This attribute value already exists',
        409,
        'DUPLICATE_ATTRIBUTE_VALUE',
      );
    }

    try {
      const created = await this.repository.createValue(tenantId, {
        attributeId: input.attributeId,
        value,
        sortOrder: input.sortOrder ?? 0,
      });
      if (!created) throw new AppError('Product attribute not found', 404, 'PRODUCT_ATTRIBUTE_NOT_FOUND');

      return toProductAttributeValueResponse(created);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'This attribute value already exists',
          409,
          'DUPLICATE_ATTRIBUTE_VALUE',
        );
      }

      throw error;
    }
  }

  async getValueById(tenantId: string, valueId: string) {
    const value = await this.repository.findValueById(tenantId, valueId);

    if (!value) {
      throw new AppError(
        'Product attribute value not found',
        404,
        'ATTRIBUTE_VALUE_NOT_FOUND',
      );
    }

    return {
      ...toProductAttributeValueResponse(value),

      attribute: {
        id: value.attribute.id,
        name: value.attribute.name,
        productId: value.attribute.productId,
      },
    };
  }

  async updateValue(tenantId: string, valueId: string, input: UpdateProductAttributeValueInput) {
    const existing = await this.repository.findValueById(tenantId, valueId);

    if (!existing) {
      throw new AppError(
        'Product attribute value not found',
        404,
        'ATTRIBUTE_VALUE_NOT_FOUND',
      );
    }

    const value = input.value !== undefined ? input.value.trim() : undefined;

    if (value !== undefined && value !== existing.value) {
      const duplicate = await this.repository.findValueByAttributeAndValue(
        tenantId,
        existing.attributeId,
        value,
      );

      if (duplicate && duplicate.id !== valueId) {
        throw new AppError(
          'This attribute value already exists',
          409,
          'DUPLICATE_ATTRIBUTE_VALUE',
        );
      }
    }

    try {
      const updated = await this.repository.updateValue(tenantId, valueId, {
        ...(value !== undefined ? { value } : {}),
        ...(input.sortOrder !== undefined
          ? { sortOrder: input.sortOrder }
          : {}),
      });
      if (!updated) throw new AppError('Product attribute value not found', 404, 'ATTRIBUTE_VALUE_NOT_FOUND');

      return toProductAttributeValueResponse(updated);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'This attribute value already exists',
          409,
          'DUPLICATE_ATTRIBUTE_VALUE',
        );
      }

      throw error;
    }
  }

  async deleteValue(tenantId: string, valueId: string) {
    const existing = await this.repository.findValueById(tenantId, valueId);

    if (!existing) {
      throw new AppError(
        'Product attribute value not found',
        404,
        'ATTRIBUTE_VALUE_NOT_FOUND',
      );
    }

    const count =
      await this.repository.countVariantsUsingAttributeValue(tenantId, valueId);

    if (count > 0) {
      throw new AppError(
        'Cannot delete an attribute value that is used by a product variant',
        409,
        'ATTRIBUTE_VALUE_IN_USE',
      );
    }

    await this.repository.deleteValue(tenantId, valueId);
  }

  // --------------------------------------------------
  // VALUE IMAGES
  // --------------------------------------------------

  async setValueImage(tenantId: string, valueId: string, storageKey: string, url: string) {
    const existing = await this.repository.findValueById(tenantId, valueId);

    if (!existing) {
      throw new AppError(
        'Product attribute value not found',
        404,
        'ATTRIBUTE_VALUE_NOT_FOUND',
      );
    }

    const updated = await this.repository.setValueImage(
      tenantId,
      valueId,
      storageKey,
      url,
    );
    if (!updated) throw new AppError('Product attribute value not found', 404, 'ATTRIBUTE_VALUE_NOT_FOUND');

    return toProductAttributeValueResponse(updated);
  }

  async clearValueImage(tenantId: string, valueId: string) {
    const existing = await this.repository.findValueById(tenantId, valueId);

    if (!existing) {
      throw new AppError(
        'Product attribute value not found',
        404,
        'ATTRIBUTE_VALUE_NOT_FOUND',
      );
    }

    const updated = await this.repository.clearValueImage(tenantId, valueId);
    if (!updated) throw new AppError('Product attribute value not found', 404, 'ATTRIBUTE_VALUE_NOT_FOUND');

    return toProductAttributeValueResponse(updated);
  }
}
