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
  AuthenticationError,
  RateLimitError,
  ModelNotFoundError,
} from '../types.js';
import { BaseProviderClient } from '../base/BaseProviderClient.js';
import { PROVIDER_MODELS } from '../../config/providerConfig.js';

/**
 * Claude API response interfaces
 */
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ClaudeStreamChunk {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  index?: number;
  delta?: {
    type: 'text_delta';
    text: string;
  };
  message?: ClaudeResponse;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Claude provider client
 */
export class ClaudeProviderClient extends BaseProviderClient {
  readonly provider = AIProvider.CLAUDE;
  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsTools: true,
    supportsImages: true,
    supportsSystemPrompts: true,
    maxContextLength: 200000, // 200k tokens for Claude 3.5
    supportedModels: PROVIDER_MODELS[AIProvider.CLAUDE],
  };

  private apiKey: string;
  private endpoint: string;

  constructor(config: ProviderConfig) {
    super(config);
    
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages';
    
    if (!this.apiKey) {
      throw new AuthenticationError('Claude API key is required', AIProvider.CLAUDE);
    }
  }

  async generateContent(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<UnifiedResponse> {
    this.validateRequest(request);
    
    const claudeRequest = this.convertFromUnifiedRequest(request);

    try {
      const response = await this.makeApiRequest(claudeRequest);
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
    
    const claudeRequest = {
      ...this.convertFromUnifiedRequest(request),
      stream: true,
    };

    try {
      const stream = await this.makeStreamRequest(claudeRequest);
      return this.convertStreamToUnified(stream, promptId);
    } catch (error) {
      throw this.handleError(error, promptId);
    }
  }

  async countTokens(contents: Content[]): Promise<{ totalTokens: number }> {
    // Claude doesn't have a dedicated token counting endpoint
    // Use estimation based on text content
    return { totalTokens: this.estimateTokens(contents) };
  }

  async validateConfig(): Promise<boolean> {
    return !!(this.apiKey && this.endpoint);
  }

  async getAvailableModels(): Promise<string[]> {
    // Claude doesn't provide a models endpoint, return predefined list
    return this.capabilities.supportedModels;
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a minimal request
      const testRequest = {
        model: this.config.model,
        max_tokens: 1,
        messages: [{ role: 'user' as const, content: 'Hi' }],
      };
      
      await this.makeApiRequest(testRequest);
      return true;
    } catch (error) {
      console.warn('Claude connection test failed:', error);
      return false;
    }
  }

  protected convertToUnifiedResponse(
    response: ClaudeResponse,
    promptId: string,
  ): UnifiedResponse {
    const baseResponse = this.createBaseResponse(promptId);
    
    // Convert Claude content to Gemini-compatible format
    const content: Content[] = [{
      role: 'model',
      parts: response.content.map(block => ({ text: block.text })),
    }];
    
    return {
      ...baseResponse,
      content,
      usageMetadata: {
        promptTokenCount: response.usage.input_tokens,
        candidatesTokenCount: response.usage.output_tokens,
        totalTokenCount: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }

  protected convertFromUnifiedRequest(request: UnifiedRequest): any {
    const messages: ClaudeMessage[] = [];
    let systemPrompt: string | undefined;

    // Convert Gemini Content format to Claude messages
    for (const content of request.contents) {
      if (content.role === 'user') {
        const claudeContent = this.convertPartsToClaudeContent(content.parts || []);
        messages.push({
          role: 'user',
          content: claudeContent,
        });
      } else if (content.role === 'model') {
        // Convert model response to assistant message
        const text = content.parts
          ?.filter(part => 'text' in part)
          .map(part => (part as any).text)
          .join('\n') || '';
        
        if (text) {
          messages.push({
            role: 'assistant',
            content: text,
          });
        }
      }
    }

    // Extract system prompt from first user message if it looks like a system prompt
    if (messages.length > 0 && messages[0].role === 'user' && 
        typeof messages[0].content === 'string' && 
        messages[0].content.toLowerCase().includes('you are')) {
      systemPrompt = messages[0].content;
      messages.shift(); // Remove from messages
    }

    const claudeRequest: any = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages,
    };

    if (systemPrompt) {
      claudeRequest.system = systemPrompt;
    }

    if (request.temperature !== undefined) {
      claudeRequest.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      claudeRequest.top_p = request.topP;
    }

    // TODO: Add tools support when needed
    // if (request.tools) {
    //   claudeRequest.tools = this.convertToolsToClaudeFormat(request.tools);
    // }

    return claudeRequest;
  }

  /**
   * Convert Gemini parts to Claude content format
   */
  private convertPartsToClaudeContent(parts: Part[]): string | Array<any> {
    if (parts.length === 1 && 'text' in parts[0]) {
      return (parts[0] as any).text;
    }

    const claudeContent: Array<any> = [];

    for (const part of parts) {
      if ('text' in part) {
        claudeContent.push({
          type: 'text',
          text: (part as any).text,
        });
      } else if ('inlineData' in part) {
        // Convert inline data to Claude image format
        const inlineData = (part as any).inlineData;
        claudeContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: inlineData.mimeType,
            data: inlineData.data,
          },
        });
      }
    }

    return claudeContent.length === 1 && claudeContent[0].type === 'text' 
      ? claudeContent[0].text 
      : claudeContent;
  }

  /**
   * Make API request to Claude
   */
  private async makeApiRequest(request: any): Promise<ClaudeResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    return response.json();
  }

  /**
   * Make streaming request to Claude
   */
  private async makeStreamRequest(request: any): Promise<ReadableStream> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    return response.body!;
  }

  /**
   * Convert Claude stream to unified format
   */
  private async *convertStreamToUnified(
    stream: ReadableStream,
    promptId: string,
  ): AsyncGenerator<UnifiedResponse> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let currentMessage: Partial<ClaudeResponse> = {};
    let currentText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as ClaudeStreamChunk;
              
              switch (data.type) {
                case 'message_start':
                  currentMessage = data.message || {};
                  break;
                  
                case 'content_block_delta':
                  if (data.delta?.text) {
                    currentText += data.delta.text;
                    
                    // Yield incremental response
                    const baseResponse = this.createBaseResponse(promptId);
                    yield {
                      ...baseResponse,
                      content: [{
                        role: 'model',
                        parts: [{ text: currentText }],
                      }],
                    };
                  }
                  break;
                  
                case 'message_stop':
                  // Final response with usage data
                  if (data.usage && currentMessage) {
                    const baseResponse = this.createBaseResponse(promptId);
                    yield {
                      ...baseResponse,
                      content: [{
                        role: 'model',
                        parts: [{ text: currentText }],
                      }],
                      usageMetadata: {
                        promptTokenCount: data.usage.input_tokens,
                        candidatesTokenCount: data.usage.output_tokens,
                        totalTokenCount: data.usage.input_tokens + data.usage.output_tokens,
                      },
                    };
                  }
                  break;
              }
            } catch (parseError) {
              // Skip invalid JSON chunks
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle HTTP errors from Claude API
   */
  private async handleHttpError(response: Response): Promise<never> {
    const errorText = await response.text();
    let errorMessage = `Claude API error: ${response.status} ${response.statusText}`;
    
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error?.message) {
        errorMessage = errorData.error.message;
      }
    } catch {
      // Use the raw error text if JSON parsing fails
      if (errorText) {
        errorMessage = errorText;
      }
    }

    switch (response.status) {
      case 401:
        throw new AuthenticationError(errorMessage, AIProvider.CLAUDE);
      case 429:
        throw new RateLimitError(errorMessage, AIProvider.CLAUDE);
      case 404:
        throw new ModelNotFoundError(errorMessage, AIProvider.CLAUDE, this.config.model);
      default:
        throw this.handleError(new Error(errorMessage));
    }
  }

  /**
   * Map Claude stop reason to unified format
   */
  private mapStopReason(stopReason: string): string {
    switch (stopReason) {
      case 'end_turn':
        return 'STOP';
      case 'max_tokens':
        return 'MAX_TOKENS';
      case 'stop_sequence':
        return 'STOP';
      default:
        return 'OTHER';
    }
  }

  /**
   * Enhanced token estimation for Claude
   */
  protected estimateTokens(contents: Content[]): number {
    let totalTokens = 0;
    
    for (const content of contents) {
      if (content.parts) {
        for (const part of content.parts) {
          if ('text' in part && (part as any).text) {
            // Claude typically has ~3.5 characters per token
            totalTokens += Math.ceil((part as any).text.length / 3.5);
          }
        }
      }
    }
    
    return totalTokens;
  }
}