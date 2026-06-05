import { logger as defaultLogger, type Logger } from "./logger.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  sleep?: (delayMs: number) => Promise<void>;
  logger?: Logger;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function retry<T>(
  operation: string,
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const log = options.logger ?? defaultLogger;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const result = await fn();
      if (attempt > 1) {
        log.info("retry_succeeded", { operation, attempt });
      }
      return result;
    } catch (error) {
      lastError = error;
      const canRetry = attempt < options.maxAttempts && (options.shouldRetry?.(error, attempt) ?? true);
      log.warn("retry_attempt_failed", { operation, attempt, canRetry }, error);
      if (!canRetry) break;

      await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }

  log.error("retry_exhausted", { operation, maxAttempts: options.maxAttempts }, lastError);
  throw lastError;
}
