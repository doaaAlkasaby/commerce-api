import admin from 'firebase-admin';
import fs from 'node:fs';
import { env } from '../../config/env.js';
import { logger } from '../logger/logger.js';

export interface SendMulticastInput {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface SendMulticastResult {
  isDryRun: boolean;
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  successfulTokens: string[];
}

export const EXPECTED_FIREBASE_PROJECT_ID = 'e-commerce-2da8f';

export class FirebaseAdminService {
  private messagingInstance: admin.messaging.Messaging | null = null;
  private isConfigured = false;

  constructor() {
    this.initFirebase();
  }

  private initFirebase(): void {
    if (
      env.GOOGLE_APPLICATION_CREDENTIALS &&
      fs.existsSync(env.GOOGLE_APPLICATION_CREDENTIALS)
    ) {
      try {
        const fileContent = fs.readFileSync(
          env.GOOGLE_APPLICATION_CREDENTIALS,
          'utf8',
        );
        const serviceAccount = JSON.parse(fileContent);

        if (serviceAccount.project_id !== EXPECTED_FIREBASE_PROJECT_ID) {
          logger.error(
            {
              category: 'FIREBASE_PROJECT_MISMATCH',
              expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
              loadedProjectId: serviceAccount.project_id,
            },
            'Firebase service account JSON project ID does not match required project e-commerce-2da8f.',
          );
          this.isConfigured = false;
          return;
        }

        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        }
        this.messagingInstance = admin.messaging();
        this.isConfigured = true;
        logger.info(
          {
            category: 'FIREBASE_INIT',
            projectId: EXPECTED_FIREBASE_PROJECT_ID,
            method: 'GOOGLE_APPLICATION_CREDENTIALS',
          },
          'Firebase Admin SDK initialized successfully via GOOGLE_APPLICATION_CREDENTIALS.',
        );
        return;
      } catch (error) {
        logger.error(
          { category: 'FIREBASE_INIT_ERROR', error },
          'Failed to load Firebase service account JSON from GOOGLE_APPLICATION_CREDENTIALS.',
        );
        this.isConfigured = false;
        return;
      }
    }

    if (
      env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY
    ) {
      if (env.FIREBASE_PROJECT_ID !== EXPECTED_FIREBASE_PROJECT_ID) {
        logger.error(
          {
            category: 'FIREBASE_PROJECT_MISMATCH',
            expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
            loadedProjectId: env.FIREBASE_PROJECT_ID,
          },
          'FIREBASE_PROJECT_ID environment variable does not match required project e-commerce-2da8f.',
        );
        this.isConfigured = false;
        return;
      }

      try {
        if (!admin.apps.length) {
          const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: env.FIREBASE_PROJECT_ID,
              clientEmail: env.FIREBASE_CLIENT_EMAIL,
              privateKey,
            }),
          });
        }
        this.messagingInstance = admin.messaging();
        this.isConfigured = true;
        logger.info(
          {
            category: 'FIREBASE_INIT',
            projectId: EXPECTED_FIREBASE_PROJECT_ID,
            method: 'ENVIRONMENT_VARIABLES',
          },
          'Firebase Admin SDK initialized successfully via environment variables.',
        );
        return;
      } catch (error) {
        logger.error(
          { category: 'FIREBASE_INIT_ERROR', error },
          'Failed to initialize Firebase Admin SDK via environment variables.',
        );
        this.isConfigured = false;
        return;
      }
    }

    logger.info(
      { category: 'FIREBASE_INIT' },
      'Firebase credentials omitted. Push notification dispatch will run in Dry-Run mode.',
    );
    this.isConfigured = false;
  }

  async sendMulticastNotification(
    input: SendMulticastInput,
  ): Promise<SendMulticastResult> {
    const { tokens, title, body, data } = input;

    if (!tokens.length) {
      return {
        isDryRun: !this.isConfigured,
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        successfulTokens: [],
      };
    }

    if (!this.isConfigured || !this.messagingInstance) {
      logger.warn(
        {
          category: 'FIREBASE_UNCONFIGURED',
          targetTokenCount: tokens.length,
          title,
          eventType: data['eventType'],
          environment: env.NODE_ENV,
        },
        'Firebase Admin SDK is not configured. Push delivery deferred.',
      );

      if (env.NODE_ENV === 'test') {
        return {
          isDryRun: true,
          successCount: tokens.length,
          failureCount: 0,
          invalidTokens: [],
          successfulTokens: [...tokens],
        };
      }

      throw new Error('Firebase credentials unconfigured');
    }

    try {
      const response = await this.messagingInstance.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'high_importance_channel',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      });

      const invalidTokens: string[] = [];
      const successfulTokens: string[] = [];

      response.responses.forEach(
        (res: admin.messaging.SendResponse, idx: number) => {
          const targetToken = tokens[idx];
          if (!targetToken) return;

          if (res.success) {
            successfulTokens.push(targetToken);
          } else if (res.error) {
            const code = res.error.code;
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              invalidTokens.push(targetToken);
            }
          }
        },
      );

      return {
        isDryRun: false,
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
        successfulTokens,
      };
    } catch (error) {
      logger.error(
        { category: 'FCM_SEND_MULTICAST_ERROR', error },
        'Failed to execute FCM multicast send',
      );
      throw error;
    }
  }
}

export const firebaseAdminService = new FirebaseAdminService();
