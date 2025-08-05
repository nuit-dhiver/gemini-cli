/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Part } from '@google/genai';
import {
  AIProvider,
  ProviderConfig,
  ProviderCapabilities,
  UnifiedRequest,
  UnifiedResponse,
  ProviderError,
} from '../types.js';
import { BaseProviderClient } from '../base/BaseProviderClient.js';
import { PROVIDER_MODELS } from '../../config/providerConfig.js';

/**
 * Ollama API interfaces
 */
interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[]; // Base64 encoded images
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Ollama provider client
 */
export class OllamaProviderClient extends BaseProviderClient {
  readonly provider = AIProvider.OLLAMA;
  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsTools: false, // Most Ollama models don't support tools yet
    supportsImages: true, // Some models like llava support images
    supportsSystemPrompts: true,
    maxContextLength: 8192, // Varies by model, this is a conservative default
    supportedModels: [], // Will be populated dynamically
  };

  private endpoint: string;

  constructor(config: ProviderConfig) {
    super(config);
    
    this.endpoint = config.endpoint || process.env.OLLAMA_HOST || 'http://localhost:11434';
    
    // Ensure endpoint ends with /api if not already there
    if (!this.endpoint.endsWith('/api')) {
      this.endpoint = this.endpoint.replace(/\/$/, '') + '/api';
    }
  }

  async generateContent(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<UnifiedResponse> {
    this.validateRequest(request);
    
    const ollamaRequest = this.convertFromUnifiedRequest(request);

    try {
      const response = await this.makeApiRequest('/chat', ollamaRequest);
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
    
    const ollamaRequest = {
      ...this.convertFromUnifiedRequest(request),
      stream: true,
    };

    try {
      const stream = await this.makeStreamRequest('/chat', ollamaRequest);
      return this.convertStreamToUnified(stream, promptId);
    } catch (error) {
      throw this.handleError(error, promptId);
    }
  }

  async countTokens(contents: Content[]): Promise<{ totalTokens: number }> {
    // Ollama doesn't have a dedicated token counting endpoint
    // Use estimation based on text content
    return { totalTokens: this.estimateTokens(contents) };
  }

  async validateConfig(): Promise<boolean> {
    try {
      await this.testConnection();
      return true;
    } catch (error) {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.makeApiRequest('/tags');
      const models = (response.models || []) as OllamaModelInfo[];
      const modelNames = models.map(model => model.name);
      
      // Update capabilities with actual models
      this.capabilities.supportedModels = modelNames;
      
      return modelNames;
    } catch (error) {
      console.warn('Failed to fetch Ollama models:', error);
      return PROVIDER_MODELS[AIProvider.OLLAMA];
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.makeApiRequest('/tags');
      return true;
    } catch (error) {
      console.warn('Ollama connection test failed:', error);
      return false;
    }
  }

  /**
   * Pull a model if it's not available locally
   */
  async pullModel(modelName: string): Promise<void> {
    try {
      const pullRequest = { name: modelName };
      
      // This is a streaming endpoint, but we'll wait for completion
      const response = await fetch(`${this.endpoint}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pullRequest),
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`);
      }

      // Wait for the pull to complete
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
        reader.releaseLock();
      }
    } catch (error) {
      throw new ProviderError(
        `Failed to pull model ${modelName}: ${error}`,
        AIProvider.OLLAMA,
      );
    }
  }

  protected convertToUnifiedResponse(
    response: OllamaResponse,
    promptId: string,
  ): UnifiedResponse {
    const baseResponse = this.createBaseResponse(promptId);
    
    // Convert Ollama response to Gemini-compatible format
    const content: Content[] = [{
      role: 'model',
      parts: [{ text: response.message.content }],
    }];
    
    return {
      ...baseResponse,
      content,
      usageMetadata: {
        promptTokenCount: response.prompt_eval_count,
        candidatesTokenCount: response.eval_count,
        totalTokenCount: (response.prompt_eval_count || 0) + (response.eval_count || 0),
      },
      finishReason: response.done ? 'STOP' : 'OTHER',
    };
  }

  protected convertFromUnifiedRequest(request: UnifiedRequest): OllamaRequest {
    const messages: OllamaMessage[] = [];

    // Convert Gemini Content format to Ollama messages
    for (const content of request.contents) {
      if (content.role === 'user' || content.role === 'model') {
        const ollamaRole = content.role === 'model' ? 'assistant' : content.role;
        const text = this.extractTextFromParts(content.parts || []);
        const images = this.extractImagesFromParts(content.parts || []);

        if (text || images.length > 0) {
          const message: OllamaMessage = {
            role: ollamaRole,
            content: text,
          };

          if (images.length > 0) {
            message.images = images;
          }

          messages.push(message);
        }
      }
    }

    const ollamaRequest: OllamaRequest = {
      model: request.model,
      messages,
    };

    // Add options if specified
    const options: any = {};
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }
    if (request.topP !== undefined) {
      options.top_p = request.topP;
    }
    if (request.maxTokens !== undefined) {
      options.num_predict = request.maxTokens;
    }

    if (Object.keys(options).length > 0) {
      ollamaRequest.options = options;
    }

    return ollamaRequest;
  }

  /**
   * Extract text content from parts
   */
  private extractTextFromParts(parts: Part[]): string {
    return parts
      .filter(part => 'text' in part)
      .map(part => (part as any).text)
      .join('\n');
  }

  /**
   * Extract base64 images from parts
   */
  private extractImagesFromParts(parts: Part[]): string[] {
    const images: string[] = [];

    for (const part of parts) {
      if ('inlineData' in part) {
        const inlineData = (part as any).inlineData;
        if (inlineData.mimeType.startsWith('image/')) {
          images.push(inlineData.data);
        }
      }
    }

    return images;
  }

  /**
   * Make API request to Ollama
   */
  private async makeApiRequest(path: string, body?: any): Promise<any> {
    const url = `${this.endpoint}${path}`;
    
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(
        `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
        AIProvider.OLLAMA,
      );
    }

    return response.json();
  }

  /**
   * Make streaming request to Ollama
   */
  private async makeStreamRequest(path: string, body: any): Promise<ReadableStream> {
    const url = `${this.endpoint}${path}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(
        `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
        AIProvider.OLLAMA,
      );
    }

    return response.body!;
  }

  /**
   * Convert Ollama stream to unified format
   */
  private async *convertStreamToUnified(
    stream: ReadableStream,
    promptId: string,
  ): AsyncGenerator<UnifiedResponse> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as OllamaResponse;
            
            if (data.message?.content) {
              accumulatedText += data.message.content;
              
              // Yield incremental response
              const baseResponse = this.createBaseResponse(promptId);
              yield {
                ...baseResponse,
                content: [{
                  role: 'model',
                  parts: [{ text: data.message.content }],
                }],
                finishReason: data.done ? 'STOP' : undefined,
              };
            }

            // Final response with complete text and metadata
            if (data.done) {
              const baseResponse = this.createBaseResponse(promptId);
              yield {
                ...baseResponse,
                content: [{
                  role: 'model',
                  parts: [{ text: accumulatedText }],
                }],
                usageMetadata: {
                  promptTokenCount: data.prompt_eval_count,
                  candidatesTokenCount: data.eval_count,
                  totalTokenCount: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                },
                finishReason: 'STOP',
              };
            }
          } catch (parseError) {
            // Skip invalid JSON chunks
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Enhanced token estimation for Ollama
   */
  protected estimateTokens(contents: Content[]): number {
    let totalTokens = 0;
    
    for (const content of contents) {
      if (content.parts) {
        for (const part of content.parts) {
          if ('text' in part && (part as any).text) {
            // Ollama models typically have ~4 characters per token
            totalTokens += Math.ceil((part as any).text.length / 4);
          }
        }
      }
    }
    
    return totalTokens;
  }

  /**
   * Check if a model is available locally
   */
  async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const models = await this.getAvailableModels();
      return models.includes(modelName);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get model information
   */
  async getModelInfo(modelName: string): Promise<OllamaModelInfo | null> {
    try {
      const response = await this.makeApiRequest(`/show`, { name: modelName });
      return response;
    } catch (error) {
      return null;
    }
  }
}