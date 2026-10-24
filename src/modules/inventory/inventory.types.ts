import type {
  InventoryTransactionType,
} from '../../generated/prisma/client.js';

export interface CreateInventoryInput {
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

export interface ReservationInput {
  quantity: number;
  referenceId: string;
  reason?: string;
}

export interface ReleaseInput {
  quantity: number;
  referenceId: string;
  reason?: string;
}

export interface SaleInput {
  quantity: number;
  referenceId: string;
  reason?: string;
}

export interface InventoryListQuery {
  page: number;
  limit: number;
  variantId?: string;
  lowStock?: number;
}

export interface InventoryResponse {
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