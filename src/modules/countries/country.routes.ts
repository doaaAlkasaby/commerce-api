import { Router } from 'express';

import { CountryController } from './country.controller.js';
import { CountryRepository } from './country.repository.js';
import { CountryService } from './country.service.js';

const router = Router();

const repository = new CountryRepository();
const service = new CountryService(repository);
const controller = new CountryController(service);

router.get(
  '/',
  controller.getSupportedCountries,
);

export default router;