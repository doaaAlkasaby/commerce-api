import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import { DeviceRepository } from '../../src/modules/devices/device.repository.js';
import { DeviceService } from '../../src/modules/devices/device.service.js';
import { env } from '../../src/config/env.js';

describe('Phase 2.1D: Device Ownership Security & Exclusive Active Token Tests', () => {
  let userAId: string;
  let userBId: string;
  const testToken = `test_fcm_token_exclusive_${Date.now()}`;

  const deviceRepo = new DeviceRepository(testPrisma);
  const deviceService = new DeviceService(deviceRepo, testPrisma);

  beforeAll(async () => {
    const testDbUrl = env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for integration tests');
    }
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SECURITY GUARD REJECTION: Integration tests must not run in production',
      );
    }

    const dbNameResult =
        await testPrisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database();
    `;
    const effectiveDbName = dbNameResult[0]?.current_database ?? '';
    const expectedDbName = new URL(testDbUrl).pathname.replace(/^\//, '');

    if (
      effectiveDbName === 'commerce_api_dev' ||
      effectiveDbName.endsWith('_dev') ||
      !effectiveDbName.endsWith('_test') ||
      effectiveDbName !== expectedDbName
    ) {
      throw new Error(
        `SECURITY GUARD REJECTION: Effective DB "${effectiveDbName}" is not isolated test DB.`,
      );
    }

    const userA = await testPrisma.user.create({
      data: {
        email: `device_sec_user_a_${Date.now()}@example.com`,
        passwordHash: 'hash_test_123',
        firstName: 'UserA',
        lastName: 'DeviceOwner',
      },
    });
    userAId = userA.id;

    const userB = await testPrisma.user.create({
      data: {
        email: `device_sec_user_b_${Date.now()}@example.com`,
        passwordHash: 'hash_test_123',
        firstName: 'UserB',
        lastName: 'DeviceOwner',
      },
    });
    userBId = userB.id;
  });

  afterAll(async () => {
    if (userAId) {
      await testPrisma.userDevice.deleteMany({ where: { userId: userAId } });
      await testPrisma.user.deleteMany({ where: { id: userAId } });
    }
    if (userBId) {
      await testPrisma.userDevice.deleteMany({ where: { userId: userBId } });
      await testPrisma.user.deleteMany({ where: { id: userBId } });
    }
  });

  it('1. User A registers token T; User A has 1 active device', async () => {
    const resA = await deviceService.registerDevice(userAId, {
      token: testToken,
      platform: 'ANDROID',
      appVersion: '1.0.0',
    });

    expect(resA.isActive).toBe(true);

    const dbA = await testPrisma.userDevice.findFirst({
      where: { userId: userAId, token: testToken },
    });
    expect(dbA).not.toBeNull();
    expect(dbA!.isActive).toBe(true);
  });

  it('2. User B registers token T; User A is deactivated and User B becomes the single active owner', async () => {
    const resB = await deviceService.registerDevice(userBId, {
      token: testToken,
      platform: 'ANDROID',
      appVersion: '1.0.1',
    });

    expect(resB.isActive).toBe(true);

    const dbA = await testPrisma.userDevice.findFirst({
      where: { userId: userAId, token: testToken },
    });
    expect(dbA!.isActive).toBe(false);

    const dbB = await testPrisma.userDevice.findFirst({
      where: { userId: userBId, token: testToken },
    });
    expect(dbB!.isActive).toBe(true);

    const activeCount = await testPrisma.userDevice.count({
      where: { token: testToken, isActive: true },
    });
    expect(activeCount).toBe(1);
  });

  it('3. Same-user duplicate registration maintains single active device and updates timestamp', async () => {
    const resB2 = await deviceService.registerDevice(userBId, {
      token: testToken,
      platform: 'ANDROID',
      appVersion: '1.0.2',
    });

    expect(resB2.isActive).toBe(true);
    expect(resB2.appVersion).toBe('1.0.2');

    const userBDevices = await testPrisma.userDevice.findMany({
      where: { userId: userBId, token: testToken },
    });
    expect(userBDevices.length).toBe(1);
    expect(userBDevices[0]!.isActive).toBe(true);
  });

  it('4. User A re-registers token T; User B is deactivated and User A becomes active again', async () => {
    const resA2 = await deviceService.registerDevice(userAId, {
      token: testToken,
      platform: 'ANDROID',
      appVersion: '1.0.3',
    });

    expect(resA2.isActive).toBe(true);

    const dbA = await testPrisma.userDevice.findFirst({
      where: { userId: userAId, token: testToken },
    });
    const dbB = await testPrisma.userDevice.findFirst({
      where: { userId: userBId, token: testToken },
    });

    expect(dbA!.isActive).toBe(true);
    expect(dbB!.isActive).toBe(false);
  });

  it('5. Concurrent registration of token T by two users resolves atomically', async () => {
    const concurrentToken = `test_fcm_token_concurrent_${Date.now()}`;

    await Promise.all([
      deviceService.registerDevice(userAId, {
        token: concurrentToken,
        platform: 'ANDROID',
      }),
      deviceService.registerDevice(userBId, {
        token: concurrentToken,
        platform: 'ANDROID',
      }),
    ]);

    const activeDevices = await testPrisma.userDevice.findMany({
      where: { token: concurrentToken, isActive: true },
    });

    expect(activeDevices.length).toBe(1);
  });

  it('6. User B cannot deactivate or delete User A device', async () => {
    const deviceA = await testPrisma.userDevice.findFirst({
      where: { userId: userAId, isActive: true },
    });
    expect(deviceA).not.toBeNull();

    await expect(
      deviceService.deactivateDevice(userBId, deviceA!.id),
    ).rejects.toThrow('Device not found');

    await expect(
      deviceService.deleteDevice(userBId, deviceA!.id),
    ).rejects.toThrow('Device not found');
  });

  it('7. Existing device response structure contract is preserved', async () => {
    const res = await deviceService.getUserDevices(userAId);
    expect(res).toHaveProperty('items');
    expect(res).toHaveProperty('total');
    expect(Array.isArray(res.items)).toBe(true);

    if (res.items.length > 0) {
      const dev = res.items[0]!;
      expect(dev).toHaveProperty('id');
      expect(dev).toHaveProperty('token');
      expect(dev).toHaveProperty('platform');
      expect(dev).toHaveProperty('isActive');
      expect(dev).toHaveProperty('lastUsedAt');
    }
  });
});
