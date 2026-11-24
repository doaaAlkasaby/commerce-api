import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { createPasswordResetService } from '../../src/modules/auth/password-reset.service.js';
import { createUserRepository } from '../../src/modules/users/user.repository.js';
import { createRefreshTokenRepository } from '../../src/modules/auth/refresh-token.repository.js';
import { createPasswordResetTokenRepository } from '../../src/modules/auth/password-reset-token.repository.js';
import { createEmailVerificationService } from '../../src/modules/auth/email-verification.service.js';
import { createEmailVerificationTokenRepository } from '../../src/modules/auth/email-verification-token.repository.js';
import { NotificationRepository } from '../../src/modules/notifications/notification.repository.js';
import { hashPassword } from '../../src/common/security/password.js';

describe('Phase NOTIF-8E: Password Security Notifications PostgreSQL Integration Tests', () => {
  const userRepo = createUserRepository(testPrisma);
  const refreshTokenRepo = createRefreshTokenRepository(testPrisma);
  const emailVerifTokenRepo = createEmailVerificationTokenRepository(testPrisma);
  const passwordResetTokenRepo = createPasswordResetTokenRepository(testPrisma);
  const emailVerifService = createEmailVerificationService(emailVerifTokenRepo, userRepo);
  const notifRepo = new NotificationRepository(testPrisma);

  const authService = createAuthService(userRepo, refreshTokenRepo, emailVerifService);
  const passwordResetService = createPasswordResetService(userRepo, passwordResetTokenRepo);

  const tenantId = randomUUID();
  const foreignTenantId = randomUUID();
  const customerId = randomUUID();
  const tenantSlug = `sec-notif-${tenantId}`;
  let currentPassword = 'InitialSecurePassword123!';

  beforeAll(async () => {
    await testPrisma.tenant.createMany({
      data: [
        { id: tenantId, slug: tenantSlug, name: 'SecurityStore', code: tenantId },
        {
          id: foreignTenantId,
          slug: `foreign-${foreignTenantId}`,
          name: 'ForeignStore',
          code: foreignTenantId,
        },
      ],
    });

    const passwordHash = await hashPassword(currentPassword);

    await testPrisma.user.create({
      data: {
        id: customerId,
        email: `${customerId}@example.test`,
        passwordHash,
        firstName: 'Security',
        lastName: 'Customer',
        tenantMemberships: {
          create: {
            tenantId,
            role: 'CUSTOMER',
          },
        },
      },
    });
  });

  afterAll(async () => {
    await testPrisma.passwordChangeRequest.deleteMany({ where: { userId: customerId } });
    await testPrisma.notificationPushJob.deleteMany({ where: { notification: { userId: customerId } } });
    await testPrisma.notification.deleteMany({ where: { userId: customerId } });
    await testPrisma.refreshToken.deleteMany({ where: { userId: customerId } });
    await testPrisma.passwordResetToken.deleteMany({ where: { userId: customerId } });
    await testPrisma.tenantMember.deleteMany({ where: { userId: customerId } });
    await testPrisma.user.deleteMany({ where: { id: customerId } });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, foreignTenantId] } },
    });
    await testPrisma.$disconnect();
  });

  function getAccountSecurityNotifications() {
    return testPrisma.notification.findMany({
      where: { userId: customerId, scope: 'ACCOUNT', type: 'SYSTEM' },
      orderBy: { createdAt: 'asc' },
    });
  }

  it('1. Authenticated password change creates ACCOUNT-scoped notification with null tenantId and outbox job', async () => {
    const newPassword = 'NewPassword456!';
    await authService.changePassword(customerId, currentPassword, newPassword);
    currentPassword = newPassword;

    const notifs = await getAccountSecurityNotifications();
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      scope: 'ACCOUNT',
      tenantId: null,
      userId: customerId,
      type: 'SYSTEM',
      title: 'Security Alert: Password Changed',
    });

    const job = await testPrisma.notificationPushJob.findUniqueOrThrow({
      where: { notificationId: notifs[0]!.id },
    });
    expect(job).toMatchObject({ tenantId: null, state: 'READY' });
  });

  it('2. Account-scoped security notification is returned when querying user notifications for any storefront tenant', async () => {
    const listResultTenantA = await notifRepo.findUserNotifications(tenantId, customerId, 0, 10);
    const listResultTenantB = await notifRepo.findUserNotifications(foreignTenantId, customerId, 0, 10);

    expect(listResultTenantA.items.some((n) => n.scope === 'ACCOUNT')).toBe(true);
    expect(listResultTenantB.items.some((n) => n.scope === 'ACCOUNT')).toBe(true);
  });

  it('3. Invalid current password rejects update and creates zero notifications', async () => {
    const initialCount = (await getAccountSecurityNotifications()).length;

    await expect(
      authService.changePassword(customerId, 'WrongPassword123!', 'AnotherPassword789!'),
    ).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });

    const finalCount = (await getAccountSecurityNotifications()).length;
    expect(finalCount).toBe(initialCount);
  });

  it('4. Successful password reset creates ACCOUNT-scoped notification and outbox job', async () => {
    const userEmail = `${customerId}@example.test`;
    await passwordResetService.forgotPassword(userEmail);

    const tokenRecord = await testPrisma.passwordResetToken.findFirstOrThrow({
      where: { userId: customerId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const rawToken = 'raw-test-reset-token-123';
    const crypto = await import('../../src/common/security/token.js');
    const tokenHash = crypto.hashToken(rawToken);

    await testPrisma.passwordResetToken.update({
      where: { id: tokenRecord.id },
      data: { tokenHash },
    });

    const resetPasswordValue = 'ResetPassword999!';
    await passwordResetService.resetPassword(rawToken, resetPasswordValue);
    currentPassword = resetPasswordValue;

    const notifs = await getAccountSecurityNotifications();
    const resetNotif = notifs.find(
      (n) => (n.data as any)?.eventType === 'PASSWORD_RESET_COMPLETED',
    );
    expect(resetNotif).toBeDefined();
    expect(resetNotif!).toMatchObject({
      scope: 'ACCOUNT',
      tenantId: null,
      userId: customerId,
      eventKey: `password_reset_${tokenRecord.id}`,
      title: 'Security Alert: Password Reset',
    });
  });

  it('5. Reused reset token is rejected and creates no duplicate notification', async () => {
    const notifCountBefore = (await getAccountSecurityNotifications()).length;
    const rawToken = 'raw-test-reset-token-123';

    await expect(
      passwordResetService.resetPassword(rawToken, 'ShouldFail123!'),
    ).rejects.toMatchObject({ code: 'PASSWORD_RESET_TOKEN_ALREADY_USED' });

    const notifCountAfter = (await getAccountSecurityNotifications()).length;
    expect(notifCountAfter).toBe(notifCountBefore);
  });

  it('6. Two separate password changes with distinct operation IDs create distinct ACCOUNT notifications', async () => {
    const initialCount = (await getAccountSecurityNotifications()).length;

    const pwd1 = 'PasswordOne111!';
    await authService.changePassword(customerId, currentPassword, pwd1, 'op-pass-1');
    currentPassword = pwd1;

    const pwd2 = 'PasswordTwo222!';
    await authService.changePassword(customerId, currentPassword, pwd2, 'op-pass-2');
    currentPassword = pwd2;

    const notifs = await getAccountSecurityNotifications();
    expect(notifs.length).toBe(initialCount + 2);
  });

  it('7. Retrying password change with identical Idempotency-Key replays stored 200 OK success response', async () => {
    const pwdTarget = 'DurablePassword888!';
    const key = 'durable-idempotency-key-101';

    // Request 1: Initial change
    const res1 = await authService.changePassword(customerId, currentPassword, pwdTarget, key);
    expect(res1).toEqual({ success: true, message: 'Password changed successfully', data: null });
    currentPassword = pwdTarget;

    // Request 2: Retry with SAME idempotency key and ORIGINAL currentPassword (which is no longer in DB!)
    const res2 = await authService.changePassword(customerId, 'PasswordTwo222!', pwdTarget, key);
    expect(res2).toEqual({ success: true, message: 'Password changed successfully', data: null });
  });

  it('8. Reusing Idempotency-Key with a different target password returns 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
    const key = 'durable-idempotency-key-101';

    await expect(
      authService.changePassword(customerId, currentPassword, 'ConflictingPassword999!', key),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });

  it('9. Expired idempotency record is ignored and allows key reuse for a new valid request', async () => {
    const expiredKey = 'expired-idempotency-key-999';

    // Seed expired record
    await testPrisma.passwordChangeRequest.create({
      data: {
        userId: customerId,
        idempotencyKey: expiredKey,
        requestFingerprint: 'stale-fingerprint',
        responseStatus: 200,
        responseBody: { success: true, message: 'Old', data: null },
        expiresAt: new Date(Date.now() - 1000), // Expired!
      },
    });

    const pwdFresh = 'FreshPassword777!';
    const res = await authService.changePassword(customerId, currentPassword, pwdFresh, expiredKey);
    expect(res).toEqual({ success: true, message: 'Password changed successfully', data: null });
    currentPassword = pwdFresh;
  });
});
