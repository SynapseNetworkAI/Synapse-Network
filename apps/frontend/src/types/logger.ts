export interface UserOperationLog {
  id: string;                 // UUID
  timestamp: string;          // ISO 8601 string
  user_address: string;       // Wallet address
  action_type: string;        // E.g., 'REGISTER_SERVICE', 'WITHDRAW', etc.
  details: Record<string, unknown>; // Flexible JSON payload
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  tx_hash?: string;           // Optional on-chain transaction hash
  error_message?: string;     // Optional error message
}

export interface ILogStorageAdapter {
  /** Write a single log entry */
  write(log: UserOperationLog): Promise<void>;
  
  /** (Optional) Query logs, to be implemented by advanced adapters */
  query?(params: { user_address?: string; action_type?: string; limit?: number }): Promise<UserOperationLog[]>;
}
