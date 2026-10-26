import { CommerceContextRepository } from './commerce-context.repository.js';
import { CommerceContextService } from './commerce-context.service.js';

const repository = new CommerceContextRepository();

export const commerceContextService =
  new CommerceContextService(repository);