import { JsonlAdapter } from './adapters/JsonlAdapter';
import { ILogStorageAdapter, UserOperationLog } from '@/types/logger';

class LoggerService {
  constructor(private adapter: ILogStorageAdapter) {}

  async logAction(logData: Omit<UserOperationLog, 'id' | 'timestamp'>) {
    const fullLog: UserOperationLog = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...logData
    };
    
    try {
      // Fire and forget (or await). We catch errors so logging doesn't break the main thread.
      await this.adapter.write(fullLog);
    } catch (e) {
      console.error('[LoggerService] Failed to write operation log:', e);
    }
  }

  async queryLogs(params: { user_address?: string; action_type?: string; limit?: number }) {
    if (this.adapter.query) {
      return this.adapter.query(params);
    }
    console.warn('[LoggerService] Query method not implemented for current adapter');
    return [];
  }
}

// Factory function to inject the correct adapter based on environment
const createLogger = () => {
  // const driver = process.env.LOG_STORAGE_DRIVER || 'jsonl'; // 'jsonl', 'postgres', etc.

  // Future expansion:
  // if (driver === 'postgres' && process.env.DATABASE_URL) {
  //   return new LoggerService(new PostgresAdapter(process.env.DATABASE_URL));
  // }
  
  // Default to local JSONL for MVP
  // Align with python sdk log path or put it in a known folder
  const jsonlPath = process.env.LOG_FILE_PATH || './logs/user-ops.jsonl';
  const retentionEnv = Number.parseInt(process.env.LOG_RETENTION_DAYS ?? '', 10);
  const retentionDays = Number.isFinite(retentionEnv) && retentionEnv > 0 ? retentionEnv : 7;
  return new LoggerService(new JsonlAdapter(jsonlPath, { retentionDays }));
};

// Singleton pattern for Next.js to prevent multiple instances during hot reloading (HMR)
const globalForLogger = global as unknown as { logger: LoggerService };
export const userLogger = globalForLogger.logger || createLogger();

if (process.env.NODE_ENV !== 'production') {
  globalForLogger.logger = userLogger;
}
