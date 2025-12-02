import pRetry from 'p-retry';
import type { Logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  operationName: string,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return pRetry(operation, {
    retries: opts.maxAttempts - 1,
    minTimeout: opts.initialDelayMs,
    maxTimeout: opts.maxDelayMs,
    factor: 2,
    onFailedAttempt: (error) => {
      logger.warn(
        {
          attempt: error.attemptNumber,
          retriesLeft: error.retriesLeft,
          error: error.message,
        },
        `${operationName} failed, retrying...`
      );
    },
  });
}
