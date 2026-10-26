import { Router } from 'express';

import { validate } from '../../common/validation/validate.js';
import { homeController } from './home.controller.js';
import { homeQuerySchema } from './home.schemas.js';
import { optionalAuthenticate } from '../../middleware/optional-auth.middleware.js';



const router = Router();

router.get(
  '/',
   optionalAuthenticate,
  validate(homeQuerySchema, 'query'),
  homeController.getHome.bind(homeController),
);

export default router;