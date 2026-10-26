import { TaxRepository } from './tax.repository.js';
import { TaxService } from './tax.service.js';

const repository =
  new TaxRepository();

export const taxService =
  new TaxService(repository);