import { AppError } from '../../common/errors/app-error.js';
import { promotionStatus } from './promotion.lifecycle.js';
import type { PromotionRepository } from './promotion.repository.js';
import {
  campaignDraftSchema,
  validatePromotionDraft,
} from './promotion.schemas.js';
import type { PromotionWindow } from './promotion.types.js';

type PublicationAction = 'PUBLISH' | 'PAUSE' | 'RESUME' | 'END';

function publicationConflict(): never {
  throw new AppError(
    'Promotion lifecycle transition is unavailable',
    409,
    'INVALID_PROMOTION_TRANSITION',
  );
}

function nextPublication(
  record: PromotionWindow,
  action: PublicationAction,
  now: Date,
) {
  const status = promotionStatus(record, now);
  if (
    action === 'PUBLISH' &&
    status === 'DRAFT' &&
    (!record.endsAt || now < record.endsAt)
  )
    return 'PUBLISHED';
  if (action === 'RESUME' && status === 'PAUSED') return 'PUBLISHED';
  if (action === 'PAUSE' && (status === 'ACTIVE' || status === 'SCHEDULED'))
    return 'PAUSED';
  if (
    action === 'END' &&
    record.publication !== 'DRAFT' &&
    record.publication !== 'ENDED'
  )
    return 'ENDED';
  return publicationConflict();
}

function requireRecord<T>(record: T | null): T {
  if (!record)
    throw new AppError(
      'Promotion or campaign not found',
      404,
      'PROMOTION_NOT_FOUND',
    );
  return record;
}

export class PromotionService {
  constructor(
    private readonly repository: PromotionRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  createCampaign(tenantId: string, input: unknown) {
    return this.repository.createCampaign(
      tenantId,
      campaignDraftSchema.parse(input),
    );
  }

  async createPromotion(tenantId: string, input: unknown) {
    const currency = await this.repository.currency(tenantId);
    return this.repository.createPromotion(
      tenantId,
      validatePromotionDraft(input, currency),
      currency,
    );
  }

  async getPromotion(tenantId: string, id: string) {
    const record = requireRecord(
      await this.repository.findPromotion(tenantId, id),
    );
    return { ...record, status: promotionStatus(record, this.clock()) };
  }

  async getCampaign(tenantId: string, id: string) {
    const record = requireRecord(
      await this.repository.findCampaign(tenantId, id),
    );
    return { ...record, status: promotionStatus(record, this.clock()) };
  }

  async changePromotionPublication(
    tenantId: string,
    id: string,
    action: PublicationAction,
  ) {
    const record = requireRecord(
      await this.repository.findPromotion(tenantId, id),
    );
    const now = this.clock();
    if (
      !(await this.repository.changePromotionPublication(
        tenantId,
        record,
        nextPublication(record, action, now),
        now,
      ))
    ) {
      publicationConflict();
    }
    return this.getPromotion(tenantId, id);
  }

  async changeCampaignPublication(
    tenantId: string,
    id: string,
    action: PublicationAction,
  ) {
    const record = requireRecord(
      await this.repository.findCampaign(tenantId, id),
    );
    const now = this.clock();
    if (
      !(await this.repository.changeCampaignPublication(
        tenantId,
        record,
        nextPublication(record, action, now),
        now,
      ))
    ) {
      publicationConflict();
    }
    return this.getCampaign(tenantId, id);
  }
}
