/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AIProvider,
  ProviderConfig,
  ProviderClient,
  ProviderError,
} from '../types.js';

/**
 * Factory for creating provider clients
 */
export class ProviderFactory {
  private clientCache: Map<string, ProviderClient> = new Map();

  /**
   * Create a provider client based on configuration
   */
  async createClient(config: ProviderConfig): Promise<ProviderClient> {
    // Create cache key from config
    const cacheKey = this.createCacheKey(config);
    
    // Return cached client if available
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!;
    }

    let client: ProviderClient;

    switch (config.provider) {
      case AIProvider.GEMINI:
        client = await this.createGeminiClient(config);
        break;
      case AIProvider.CLAUDE:
        client = await this.createClaudeClient(config);
        break;
      case AIProvider.OLLAMA:
        client = await this.createOllamaClient(config);
        break;
      default:
        throw new ProviderError(
          `Unsupported provider: ${config.provider}`,
          config.provider,
        );
    }

    // Cache the client
    this.clientCache.set(cacheKey, client);
    
    return client;
  }

  /**
   * Create Gemini provider client
   */
  private async createGeminiClient(config: ProviderConfig): Promise<ProviderClient> {
    // Import dynamically to avoid circular dependencies
    const { GeminiProviderClient } = await import('../gemini/GeminiProviderClient.js');
    return new GeminiProviderClient(config);
  }

  /**
   * Create Claude provider client
   */
  private async createClaudeClient(config: ProviderConfig): Promise<ProviderClient> {
    // Import dynamically to avoid circular dependencies
    const { ClaudeProviderClient } = await import('../claude/ClaudeProviderClient.js');
    return new ClaudeProviderClient(config);
  }

  /**
   * Create Ollama provider client
   */
  private async createOllamaClient(config: ProviderConfig): Promise<ProviderClient> {
    // Import dynamically to avoid circular dependencies
    const { OllamaProviderClient } = await import('../ollama/OllamaProviderClient.js');
    return new OllamaProviderClient(config);
  }

  /**
   * Clear cached clients
   */
  clearCache(): void {
    this.clientCache.clear();
  }

  /**
   * Remove specific client from cache
   */
  removeCachedClient(config: ProviderConfig): void {
    const cacheKey = this.createCacheKey(config);
    this.clientCache.delete(cacheKey);
  }

  /**
   * Get all cached client keys
   */
  getCachedClientKeys(): string[] {
    return Array.from(this.clientCache.keys());
  }

  /**
   * Create cache key from provider configuration
   */
  private createCacheKey(config: ProviderConfig): string {
    const keyParts = [
      config.provider,
      config.model,
      config.authType,
      config.apiKey || 'no-key',
      config.endpoint || 'default-endpoint',
    ];
    
    return keyParts.join('|');
  }

  /**
   * Validate provider configuration before creating client
   */
  private validateConfig(config: ProviderConfig): void {
    if (!config.provider) {
      throw new ProviderError('Provider is required', config.provider);
    }

    if (!config.model) {
      throw new ProviderError('Model is required', config.provider);
    }

    if (!config.authType) {
      throw new ProviderError('Auth type is required', config.provider);
    }

    if (!config.enabled) {
      throw new ProviderError(
        `Provider ${config.provider} is disabled`,
        config.provider,
      );
    }
  }

  /**
   * Create multiple clients from configurations
   */
  async createClients(configs: ProviderConfig[]): Promise<Map<string, ProviderClient>> {
    const clients = new Map<string, ProviderClient>();
    
    for (const config of configs) {
      if (config.enabled) {
        try {
          const client = await this.createClient(config);
          const key = `${config.provider}-${config.model}`;
          clients.set(key, client);
        } catch (error) {
          console.warn(`Failed to create client for ${config.provider}:`, error);
        }
      }
    }
    
    return clients;
  }

  /**
   * Get provider capabilities without creating full client
   */
  getProviderCapabilities(provider: AIProvider) {
    switch (provider) {
      case AIProvider.GEMINI:
        return {
          supportsStreaming: true,
          supportsTools: true,
          supportsImages: true,
          supportsSystemPrompts: true,
          maxContextLength: 2097152, // 2M tokens for Gemini 1.5
          supportedModels: [
            'gemini-2.0-flash-exp',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
            'gemini-1.0-pro',
          ],
        };
      case AIProvider.CLAUDE:
        return {
          supportsStreaming: true,
          supportsTools: true,
          supportsImages: true,
          supportsSystemPrompts: true,
          maxContextLength: 200000, // 200k tokens for Claude 3.5
          supportedModels: [
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
          ],
        };
      case AIProvider.OLLAMA:
        return {
          supportsStreaming: true,
          supportsTools: false, // Most Ollama models don't support tools
          supportsImages: false, // Depends on model
          supportsSystemPrompts: true,
          maxContextLength: 8192, // Varies by model
          supportedModels: [
            'llama2',
            'llama2:13b',
            'llama2:70b',
            'codellama',
            'mistral',
            'mixtral',
            'phi',
          ],
        };
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Test if a provider configuration would work
   */
  async testProviderConfig(config: ProviderConfig): Promise<{
    valid: boolean;
    error?: string;
    capabilities?: any;
  }> {
    try {
      this.validateConfig(config);
      const client = await this.createClient(config);
      const isValid = await client.validateConfig();
      const canConnect = await client.testConnection();
      
      if (!isValid) {
        return { valid: false, error: 'Invalid configuration' };
      }
      
      if (!canConnect) {
        return { valid: false, error: 'Cannot connect to provider' };
      }
      
      return {
        valid: true,
        capabilities: client.capabilities,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}