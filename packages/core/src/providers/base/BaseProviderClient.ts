/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Part, Tool } from '@google/genai';
import {
  AIProvider,
  ProviderClient,
  ProviderConfig,
  ProviderCapabilities,
  UnifiedRequest,
  UnifiedResponse,
  ProviderError,
} from '../types.js';

/**
 * Abstract base class for all provider clients
 */
export abstract class BaseProviderClient implements ProviderClient {
  abstract readonly provider: AIProvider;
  abstract readonly capabilities: ProviderCapabilities;

  constructor(public readonly config: ProviderConfig) {
    if (!config.enabled) {
      throw new ProviderError(
        `Provider ${config.provider} is disabled`,
        config.provider,
      );
    }
  }

  abstract generateContent(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<UnifiedResponse>;

  abstract generateContentStream(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<AsyncGenerator<UnifiedResponse>>;

  abstract countTokens(contents: Content[]): Promise<{ totalTokens: number }>;

  abstract validateConfig(): Promise<boolean>;

  abstract getAvailableModels(): Promise<string[]>;

  abstract testConnection(): Promise<boolean>;

  /**
   * Convert provider-specific content to unified format
   */
  protected abstract convertToUnifiedResponse(
    response: any,
    promptId: string,
  ): UnifiedResponse;

  /**
   * Convert unified request to provider-specific format
   */
  protected abstract convertFromUnifiedRequest(
    request: UnifiedRequest,
  ): any;

  /**
   * Validate request against provider capabilities
   */
  protected validateRequest(request: UnifiedRequest): void {
    if (request.stream && !this.capabilities.supportsStreaming) {
      throw new ProviderError(
        `Provider ${this.provider} does not support streaming`,
        this.provider,
      );
    }

    if (request.tools && !this.capabilities.supportsTools) {
      throw new ProviderError(
        `Provider ${this.provider} does not support tools`,
        this.provider,
      );
    }

    // Check if model is supported
    if (!this.capabilities.supportedModels.includes(request.model)) {
      throw new ProviderError(
        `Model ${request.model} is not supported by provider ${this.provider}`,
        this.provider,
      );
    }

    // Check content for images if not supported
    if (!this.capabilities.supportsImages) {
      const hasImages = request.contents.some((content) =>
        content.parts?.some((part) => 'inlineData' in part || 'fileData' in part),
      );
      if (hasImages) {
        throw new ProviderError(
          `Provider ${this.provider} does not support image inputs`,
          this.provider,
        );
      }
    }

    // Validate token limits
    const estimatedTokens = this.estimateTokens(request.contents);
    if (estimatedTokens > this.capabilities.maxContextLength) {
      throw new ProviderError(
        `Request exceeds maximum context length of ${this.capabilities.maxContextLength} tokens`,
        this.provider,
      );
    }
  }

  /**
   * Basic token estimation (can be overridden by specific providers)
   */
  protected estimateTokens(contents: Content[]): number {
    let totalTokens = 0;
    
    for (const content of contents) {
      if (content.parts) {
        for (const part of content.parts) {
          if ('text' in part && part.text) {
            // Rough estimation: ~4 characters per token
            totalTokens += Math.ceil(part.text.length / 4);
          }
        }
      }
    }
    
    return totalTokens;
  }

  /**
   * Handle common errors and convert to provider errors
   */
  protected handleError(error: any, promptId?: string): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    let message = error.message || 'Unknown error';
    let code = 'UNKNOWN_ERROR';
    let statusCode = 500;

    // Common error patterns
    if (message.includes('401') || message.includes('unauthorized')) {
      code = 'AUTHENTICATION_ERROR';
      statusCode = 401;
    } else if (message.includes('429') || message.includes('rate limit')) {
      code = 'RATE_LIMIT_ERROR';
      statusCode = 429;
    } else if (message.includes('404') || message.includes('not found')) {
      code = 'NOT_FOUND_ERROR';
      statusCode = 404;
    } else if (message.includes('403') || message.includes('forbidden')) {
      code = 'FORBIDDEN_ERROR';
      statusCode = 403;
    }

    return new ProviderError(message, this.provider, code, statusCode);
  }

  /**
   * Generate a unique response ID
   */
  protected generateResponseId(): string {
    return `${this.provider}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create base unified response structure
   */
  protected createBaseResponse(promptId: string): Partial<UnifiedResponse> {
    return {
      id: this.generateResponseId(),
      provider: this.provider,
      model: this.config.model,
    };
  }

  /**
   * Retry logic for failed requests
   */
  protected async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          break;
        }

        // Don't retry certain errors
        if (
          error instanceof ProviderError &&
          (error.statusCode === 401 || 
           error.statusCode === 403 || 
           error.statusCode === 404)
        ) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 0.1 * delay;
        
        await new Promise((resolve) => 
          setTimeout(resolve, delay + jitter)
        );
      }
    }

    throw this.handleError(lastError!);
  }
}