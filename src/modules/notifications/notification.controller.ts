import type { Request, Response } from 'express';
import { notificationService } from './notification.service.instance.js';

export class NotificationController {
  async getNotifications(req: Request, res: Response): Promise<void> {
    const tenantId = req.tenant!.tenantId;
    const userId = req.user!.userId;

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    const result = await notificationService.getUserNotifications(
      tenantId,
      userId,
      {
        page,
        limit,
      },
    );

    res.json({
      success: true,
      message: null,
      data: result,
    });
  }

  async markAsRead(req: Request, res: Response): Promise<void> {
    const tenantId = req.tenant!.tenantId;
    const userId = req.user!.userId;
    const notificationId = String(req.params.notificationId);

    const notification = await notificationService.markAsRead(
      tenantId,
      userId,
      notificationId,
    );

    res.json({
      success: true,
      message: null,
      data: notification,
    });
  }

  async markAllAsRead(req: Request, res: Response): Promise<void> {
    const tenantId = req.tenant!.tenantId;
    const userId = req.user!.userId;

    await notificationService.markAllAsRead(tenantId, userId);

    res.json({
      success: true,
      message: null,
      data: null,
    });
  }

  async deleteNotification(req: Request, res: Response): Promise<void> {
    const tenantId = req.tenant!.tenantId;
    const userId = req.user!.userId;
    const notificationId = String(req.params.notificationId);

    await notificationService.deleteNotification(
      tenantId,
      userId,
      notificationId,
    );

    res.json({
      success: true,
      message: null,
      data: null,
    });
  }
}

export const notificationController = new NotificationController();

export const getNotifications = notificationController.getNotifications.bind(
  notificationController,
);
export const markNotificationAsRead = notificationController.markAsRead.bind(
  notificationController,
);
export const markAllNotificationsAsRead =
  notificationController.markAllAsRead.bind(notificationController);
export const deleteNotification =
  notificationController.deleteNotification.bind(notificationController);
