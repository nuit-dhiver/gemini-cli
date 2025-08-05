/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, GenerateContentResponse } from '@google/genai';
import {
  AIProvider,
  ProviderConfig,
  ProviderCapabilities,
  UnifiedRequest,
  UnifiedResponse,
  ProviderAuthType,
} from '../types.js';
import { BaseProviderClient } from '../base/BaseProviderClient.js';
import { ContentGenerator, createContentGenerator, createContentGeneratorConfig } from '../../core/contentGenerator.js';
import { Config } from '../../config/config.js';
import { PROVIDER_MODELS } from '../../config/providerConfig.js';

/**
 * Gemini provider client that wraps the existing Gemini implementation
 */
export class GeminiProviderClient extends BaseProviderClient {
  readonly provider = AIProvider.GEMINI;
  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsTools: true,
    supportsImages: true,
    supportsSystemPrompts: true,
    maxContextLength: 2097152, // 2M tokens for Gemini 1.5
    supportedModels: PROVIDER_MODELS[AIProvider.GEMINI],
  };

  private contentGenerator: ContentGenerator | null = null;
  private gcConfig: Config | null = null;

  constructor(config: ProviderConfig) {
    super(config);
  }

  async generateContent(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<UnifiedResponse> {
    this.validateRequest(request);
    
    const contentGenerator = await this.getContentGenerator();
    const geminiRequest = this.convertFromUnifiedRequest(request);

    try {
      const response = await contentGenerator.generateContent(geminiRequest, promptId);
      return this.convertToUnifiedResponse(response, promptId);
    } catch (error) {
      throw this.handleError(error, promptId);
    }
  }

  async generateContentStream(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<AsyncGenerator<UnifiedResponse>> {
    this.validateRequest(request);
    
    const contentGenerator = await this.getContentGenerator();
    const geminiRequest = this.convertFromUnifiedRequest(request);

    try {
      const responseStream = await contentGenerator.generateContentStream(geminiRequest, promptId);
      return this.convertStreamToUnified(responseStream, promptId);
    } catch (error) {
      throw this.handleError(error, promptId);
    }
  }

  async countTokens(contents: Content[]): Promise<{ totalTokens: number }> {
    const contentGenerator = await this.getContentGenerator();
    
    try {
      const response = await contentGenerator.countTokens({
        model: this.config.model,
        contents,
      });
      
      return { totalTokens: response.totalTokens || 0 };
    } catch (error) {
      // Fallback to estimation if token counting fails
      return { totalTokens: this.estimateTokens(contents) };
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      await this.getContentGenerator();
      return true;
    } catch (error) {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // For Gemini, return the predefined models
    // In a real implementation, this could query the API for available models
    return this.capabilities.supportedModels;
  }

  async testConnection(): Promise<boolean> {
    try {
      const contentGenerator = await this.getContentGenerator();
      
      // Test with a simple token count request
      await contentGenerator.countTokens({
        model: this.config.model,
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });
      
      return true;
    } catch (error) {
      console.warn('Gemini connection test failed:', error);
      return false;
    }
  }

  protected convertToUnifiedResponse(
    response: GenerateContentResponse,
    promptId: string,
  ): UnifiedResponse {
    const baseResponse = this.createBaseResponse(promptId);
    
    return {
      ...baseResponse,
      content: response.candidates?.map(candidate => candidate.content).filter(Boolean) || [],
      usageMetadata: response.usageMetadata ? {
        promptTokenCount: response.usageMetadata.promptTokenCount,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
        totalTokenCount: response.usageMetadata.totalTokenCount,
      } : undefined,
      finishReason: response.candidates?.[0]?.finishReason,
    };
  }

  protected convertFromUnifiedRequest(request: UnifiedRequest): any {
    return {
      model: request.model,
      contents: request.contents,
      config: {
        tools: request.tools,
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
      },
    };
  }

  /**
   * Convert streaming response to unified format
   */
  private async *convertStreamToUnified(
    responseStream: AsyncGenerator<GenerateContentResponse>,
    promptId: string,
  ): AsyncGenerator<UnifiedResponse> {
    for await (const chunk of responseStream) {
      yield this.convertToUnifiedResponse(chunk, promptId);
    }
  }

  /**
   * Get or create content generator
   */
  private async getContentGenerator(): Promise<ContentGenerator> {
    if (!this.contentGenerator) {
      // Create a minimal Config object for the content generator
      const config = this.createGeminiConfig();
      const authType = this.mapToGeminiAuthType(this.config.authType);
      const contentGeneratorConfig = createContentGeneratorConfig(config, authType);
      
      this.contentGenerator = await createContentGenerator(
        contentGeneratorConfig,
        config,
      );
    }
    
    return this.contentGenerator;
  }

  /**
   * Create a minimal Config object for Gemini integration
   */
  private createGeminiConfig(): Config {
    if (!this.gcConfig) {
      // Create a minimal config that satisfies the existing Gemini implementation
      this.gcConfig = {
        getModel: () => this.config.model,
        getProxy: () => this.config.proxy,
        getContentGeneratorConfig: () => ({
          model: this.config.model,
          apiKey: this.config.apiKey,
          authType: this.mapToGeminiAuthType(this.config.authType),
          proxy: this.config.proxy,
        }),
        getQuotaErrorOccurred: () => false,
        setModel: (model: string) => { this.config.model = model; },
        setFallbackMode: (enabled: boolean) => { /* No-op for now */ },
        flashFallbackHandler: null,
      } as any; // Type assertion to satisfy interface
    }
    
    return this.gcConfig;
  }

  /**
   * Map provider auth type to Gemini auth type
   */
  private mapToGeminiAuthType(authType: ProviderAuthType): any {
    switch (authType) {
      case ProviderAuthType.OAUTH_PERSONAL:
        return 'oauth-personal';
      case ProviderAuthType.GEMINI_API_KEY:
        return 'gemini-api-key';
      case ProviderAuthType.VERTEX_AI:
        return 'vertex-ai';
      case ProviderAuthType.CLOUD_SHELL:
        return 'cloud-shell';
      default:
        return 'gemini-api-key';
    }
  }
}