import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { JsonlAdapter } from '../adapters/JsonlAdapter';
import { UserOperationLog } from '@/types/logger';

const tmpPrefix = path.join(os.tmpdir(), 'jsonl-adapter-');

const buildLog = (overrides: Partial<UserOperationLog> = {}): UserOperationLog => ({
  id: overrides.id ?? `log_${Math.random().toString(16).slice(2)}`,
  timestamp: overrides.timestamp ?? new Date().toISOString(),
  user_address: overrides.user_address ?? '0xabc',
  action_type: overrides.action_type ?? 'REGISTER_SERVICE',
  details: overrides.details ?? {},
  status: overrides.status ?? 'SUCCESS',
  tx_hash: overrides.tx_hash,
  error_message: overrides.error_message
});

describe('JsonlAdapter', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(tmpPrefix);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T02:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('writes daily files and prunes beyond retention window', async () => {
    const adapter = new JsonlAdapter(path.join(tmpDir, 'user-ops.jsonl'), { retentionDays: 2 });

    await adapter.write(buildLog({ id: 'd1', user_address: '0xday1' }));
    expect(await fs.readdir(tmpDir)).toContain('user-ops-2026-04-14.jsonl');

    vi.setSystemTime(new Date('2026-04-15T05:00:00.000Z'));
    await adapter.write(buildLog({ id: 'd2', user_address: '0xday2', action_type: 'WITHDRAW_REQUEST' }));

    vi.setSystemTime(new Date('2026-04-16T08:00:00.000Z'));
    await adapter.write(buildLog({ id: 'd3', user_address: '0xday3', action_type: 'WITHDRAW_REQUEST' }));

    const files = await fs.readdir(tmpDir);
    expect(files).not.toContain('user-ops-2026-04-14.jsonl');
    expect(files).toContain('user-ops-2026-04-15.jsonl');
    expect(files).toContain('user-ops-2026-04-16.jsonl');

    const allLogs = await adapter.query();
    expect(allLogs.map(log => log.user_address)).toEqual(['0xday3', '0xday2']);

    const filtered = await adapter.query({ user_address: '0xday2', action_type: 'WITHDRAW_REQUEST', limit: 1 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('d2');
  });
});
