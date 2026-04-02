import fs from 'fs/promises';
import path from 'path';
import { ILogStorageAdapter, UserOperationLog } from '@/types/logger';

export class JsonlAdapter implements ILogStorageAdapter {
  private filePath: string;
  private directoryPath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.directoryPath = path.dirname(this.filePath);
  }

  private async ensureDirectory() {
    try {
      await fs.access(this.directoryPath);
    } catch {
      await fs.mkdir(this.directoryPath, { recursive: true });
    }
  }

  async write(log: UserOperationLog): Promise<void> {
    await this.ensureDirectory();
    const line = JSON.stringify(log) + '\n';
    // Append to file asynchronously
    await fs.appendFile(this.filePath, line, 'utf-8');
  }

  async query(params: { user_address?: string; action_type?: string; limit?: number }): Promise<UserOperationLog[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const lines = content.trim().split('\n');
      
      let logs: UserOperationLog[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          logs.push(JSON.parse(line));
        } catch {
          // ignore malformed line
        }
      }

      // Sort by timestamp descending (newest first)
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Filter
      if (params.user_address) {
        const queryAddress = params.user_address.toLowerCase();
        logs = logs.filter(log => log.user_address?.toLowerCase() === queryAddress);
      }
      if (params.action_type) {
        logs = logs.filter(log => log.action_type === params.action_type);
      }

      // Limit
      const limit = params.limit || 50;
      return logs.slice(0, limit);
    } catch (e: unknown) {
      if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // file doesn't exist yet
      }
      throw e;
    }
  }
}
