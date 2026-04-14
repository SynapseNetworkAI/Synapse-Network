import fs from 'fs/promises';
import path from 'path';
import { ILogStorageAdapter, UserOperationLog } from '@/types/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

interface JsonlAdapterOptions {
  retentionDays?: number;
}

interface LogFileEntry {
  path: string;
  date: Date;
}

export class JsonlAdapter implements ILogStorageAdapter {
  private readonly basePath: string;
  private readonly directoryPath: string;
  private readonly filePrefix: string;
  private readonly fileExt: string;
  private readonly retentionDays: number;

  constructor(filePath: string, options?: JsonlAdapterOptions) {
    this.basePath = path.resolve(process.cwd(), filePath);
    this.directoryPath = path.dirname(this.basePath);
    const parsed = path.parse(this.basePath);
    this.filePrefix = parsed.name;
    this.fileExt = parsed.ext || '.log';
    const configuredRetention = options?.retentionDays ?? 7;
    this.retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? Math.floor(configuredRetention) : 7;
  }

  private async ensureDirectory() {
    try {
      await fs.access(this.directoryPath);
    } catch {
      await fs.mkdir(this.directoryPath, { recursive: true });
    }
  }

  private truncateDate(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private logFileName(date: Date): string {
    const stamp = date.toISOString().slice(0, 10);
    return `${this.filePrefix}-${stamp}${this.fileExt}`;
  }

  private async listLogFiles(): Promise<LogFileEntry[]> {
    try {
      const entries = await fs.readdir(this.directoryPath);
      const matches: LogFileEntry[] = [];
      for (const entry of entries) {
        if (!entry.startsWith(`${this.filePrefix}-`) || !entry.endsWith(this.fileExt)) continue;
        const datePart = entry.slice(this.filePrefix.length + 1, entry.length - this.fileExt.length);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue;
        const parsedDate = new Date(`${datePart}T00:00:00.000Z`);
        if (Number.isNaN(parsedDate.getTime())) continue;
        matches.push({ path: path.join(this.directoryPath, entry), date: parsedDate });
      }
      return matches;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw e;
    }
  }

  private async cleanupOldFiles(referenceDate: Date): Promise<void> {
    const files = await this.listLogFiles();
    if (!files.length) return;
    const cutoff = this.truncateDate(referenceDate).getTime() - (this.retentionDays - 1) * DAY_MS;
    await Promise.all(
      files
        .filter(entry => entry.date.getTime() < cutoff)
        .map(async entry => {
          try {
            await fs.rm(entry.path);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw e;
            }
          }
        })
    );
  }

  async write(log: UserOperationLog): Promise<void> {
    await this.ensureDirectory();
    const timestamp = log.timestamp ? new Date(log.timestamp) : new Date();
    const filePath = path.join(this.directoryPath, this.logFileName(timestamp));
    const line = JSON.stringify(log) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
    await this.cleanupOldFiles(timestamp);
  }

  async query(params: { user_address?: string; action_type?: string; limit?: number } = {}): Promise<UserOperationLog[]> {
    const { user_address, action_type } = params;
    const limit = params.limit ?? 50;
    const files = await this.listLogFiles();
    if (!files.length) {
      return [];
    }

    files.sort((a, b) => b.date.getTime() - a.date.getTime());
    let logs: UserOperationLog[] = [];
    for (const entry of files) {
      try {
        const content = await fs.readFile(entry.path, 'utf-8');
        const lines = content.trim().length ? content.trim().split('\n') : [];
        for (const line of lines) {
          if (!line) continue;
          try {
            logs.push(JSON.parse(line));
          } catch {
            continue;
          }
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw e;
      }
    }

    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (user_address) {
      const queryAddress = user_address.toLowerCase();
      logs = logs.filter(log => log.user_address?.toLowerCase() === queryAddress);
    }
    if (action_type) {
      logs = logs.filter(log => log.action_type === action_type);
    }

    return logs.slice(0, limit);
  }
}
