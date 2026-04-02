'use client';

import { useCallback } from 'react';

/**
 * A custom hook for tracking user operations.
 * Sends structured log data to our Next.js API route without blocking the UI thread.
 */
export const useActionLogger = () => {
  const logAction = useCallback(async (
    action_type: string,
    status: 'SUCCESS' | 'FAILED' | 'PENDING',
    details: Record<string, unknown>,
    user_address: string,
    tx_hash?: string,
    error_message?: string
  ) => {
    try {
      // Use relatively lightweight fire-and-forget payload over Fetch API.
      // keepalive: true ensures the request reaches the server even if the user closes the tab / navigates away.
      fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type,
          status,
          details,
          user_address,
          tx_hash,
          error_message
        }),
        keepalive: true
      });
    } catch (e) {
      console.warn('[ActionLogger] Action tracking failed', e);
    }
  }, []);

  /** Helper for successful transactions */
  const logSuccess = useCallback((action_type: string, user_address: string, details: Record<string, unknown> = {}, tx_hash?: string) => {
    return logAction(action_type, 'SUCCESS', details, user_address, tx_hash);
  }, [logAction]);

  /** Helper for failed transactions */
  const logError = useCallback((action_type: string, user_address: string, error_message: string, details: Record<string, unknown> = {}) => {
    return logAction(action_type, 'FAILED', details, user_address, undefined, error_message);
  }, [logAction]);

  return { logAction, logSuccess, logError };
};
