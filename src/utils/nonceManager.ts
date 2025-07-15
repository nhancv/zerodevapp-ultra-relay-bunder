import type { Logger } from "@alto/utils";
import type { Account, PublicClient } from "viem";

/**
 * Helper function to safely extract error message from unknown error
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

/**
 * Centralized nonce management utility to ensure consistent nonce fetching
 * and avoid race conditions in transaction submission
 */
export class NonceManager {
  private publicClient: PublicClient;
  private logger: Logger;

  constructor(publicClient: PublicClient, logger: Logger) {
    this.publicClient = publicClient;
    this.logger = logger;
  }

  /**
   * Fetch the current nonce for a wallet with retry logic
   * Always uses "pending" block tag to include pending transactions
   */
  async getCurrentNonce(wallet: Account, retryCount = 3): Promise<number> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const nonce = await this.publicClient.getTransactionCount({
          address: wallet.address,
          blockTag: "pending",
        });

        this.logger.debug(
          {
            wallet: wallet.address,
            nonce,
            attempt,
          },
          "fetched current nonce"
        );

        return nonce;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          {
            wallet: wallet.address,
            attempt,
            error: getErrorMessage(error),
          },
          `failed to fetch nonce, attempt ${attempt}/${retryCount}`
        );

        if (attempt < retryCount) {
          // Wait briefly before retrying
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }
    }

    this.logger.error(
      {
        wallet: wallet.address,
        error: lastError?.message,
      },
      "failed to fetch nonce after all retry attempts"
    );

    throw lastError || new Error("Failed to fetch nonce");
  }

  /**
   * Check if two wallets have conflicting pending transactions
   * by comparing their latest vs pending nonce counts
   */
  async hasStuckTransactions(wallet: Account): Promise<boolean> {
    try {
      const [latestNonce, pendingNonce] = await Promise.all([
        this.publicClient.getTransactionCount({
          address: wallet.address,
          blockTag: "latest",
        }),
        this.publicClient.getTransactionCount({
          address: wallet.address,
          blockTag: "pending",
        }),
      ]);

      const hasStuck = pendingNonce > latestNonce + 1;

      if (hasStuck) {
        this.logger.warn(
          {
            wallet: wallet.address,
            latestNonce,
            pendingNonce,
          },
          "detected stuck transactions"
        );
      }

      return hasStuck;
    } catch (error) {
      this.logger.error(
        {
          wallet: wallet.address,
          error: getErrorMessage(error),
        },
        "failed to check for stuck transactions"
      );
      return false;
    }
  }
}

/**
 * Factory function to create a NonceManager instance
 */
export function createNonceManager(
  publicClient: PublicClient,
  logger: Logger
): NonceManager {
  return new NonceManager(publicClient, logger);
}
