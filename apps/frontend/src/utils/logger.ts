// Defines the structure of a user operation log entry
export interface UserOperationLog {
  id: string;
  timestamp: string;
  user_address: string;
  action_type: string;
  details: Record<string, unknown>;
  status: "SUCCESS" | "FAILED" | "PENDING";
  tx_hash?: string;
  error_message?: string;
}

/**
 * Sends a log entry to the backend API.
 * This is non-blocking (fire and forget) to avoid impacting user experience.
 */
export async function logUserAction(params: Omit<UserOperationLog, "id" | "timestamp">) {
  try {
    const logEntry: UserOperationLog = {
      ...params,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    fetch("/api/logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(logEntry),
    }).catch(console.error);
    
  } catch (error) {
    console.error("Failed to log user action:", error);
  }
}
