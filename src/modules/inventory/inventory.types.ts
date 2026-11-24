import type { InventoryTransactionType } from '../../generated/prisma/client.js';

export interface CreateInventoryInput {
  warehouseId?: string;
  variantId: string;
  quantity?: number;
}

export interface StockInInput {
  quantity: number;
  reason?: string;
  referenceId?: string;
}

export interface StockOutInput {
  quantity: number;
  reason?: string;
  referenceId?: string;
}

export interface AdjustmentInput {
  quantity: number;
  reason: string;
  referenceId?: string;
}

export interface InventoryListQuery {
  warehouseId?: string;
  page: number;
  limit: number;
  variantId?: string;
  search?: string;
  lowStock?: number;
}

export interface InventoryWarehouseSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface InventoryResponse {
  warehouseId: string;
  warehouse: InventoryWarehouseSummary;
  id: string;
  variantId: string;

  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;

  createdAt: string;
  updatedAt: string;

  variant: {
    id: string;
    sku: string;
    isActive: boolean;

    price: string | null;
    productBasePrice: string;

    product: {
      id: string;
      name: string;
      slug: string;
      status: string;
      thumbnailUrl: string | null;
    };

    attributes: Array<{
      attributeId: string;
      attributeName: string;
      valueId: string;
      value: string;
    }>;

    images: Array<{
      id: string;
      url: string;
      storageKey: string;
      altText: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }>;
  };
}

export interface InventoryTransactionResponse {
  id: string;
  inventoryId: string;
  type: InventoryTransactionType;
  quantity: number;
  referenceId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface PaginatedInventoryResponse {
  items: InventoryResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedTransactionResponse {
  items: InventoryTransactionResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
