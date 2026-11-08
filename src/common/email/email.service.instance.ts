import { createEmailService } from './email.service.js';
import { env } from '../../config/env.js';

export const emailService = createEmailService({
  mode: env.EMAIL_DELIVERY_MODE,
  nodeEnv: env.NODE_ENV,
  outboxDirectory: env.EMAIL_DEVELOPMENT_OUTBOX_DIR,
  uploadDirectory: env.UPLOAD_DIR,
});
