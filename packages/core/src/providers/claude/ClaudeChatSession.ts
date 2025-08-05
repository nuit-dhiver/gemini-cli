/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  Tool,
  GenerateContentResponse,
  SchemaUnion,
  Part,
} from '@google/genai';
import {
  ChatSession,
  ChatMessageParams,
  ChatGenerationConfig,
  ChatSessionCapabilities,
  BaseChatSession,
  ChatSessionError,
  ChatSessionTimeoutError,
  ChatSessionRateLimitError,
} from '../../core/chatSession.js';
import { AIProvider } from '../types.js';
import { Config } from '../../config/config.js';

/**
 * Claude-specific message format
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

/**
 * Claude API request format
 */
interface ClaudeRequest {
  model: string;
  messages: ClaudeMessage[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  system?: string;
  stream?: boolean;
  tools?: any[];
}

/**
 * Claude API response format
 */
interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Claude-specific implementation of ChatSession
 */
export class ClaudeChatSession extends BaseChatSession {
  private apiKey: string;
  private endpoint: string;
  private systemPrompt?: string;

  constructor(
    sessionId: string,
    model: string,
    private config: Config,
    apiKey?: string,
    endpoint?: string,
  ) {
    super(sessionId, AIProvider.CLAUDE, model);
    
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.endpoint = endpoint || 'https://api.anthropic.com/v1/messages';
    
    if (!this.apiKey) {
      throw new ChatSessionError(
        'Claude API key is required',
        sessionId,
        AIProvider.CLAUDE,
        'MISSING_API_KEY',
      );
    }
  }

  async sendMessage(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    
    try {
      const claudeRequest = this.convertToClaudeRequest(params, false);
      const response = await this.makeClaudeRequest(claudeRequest);
      
      // Convert Claude response to Gemini format
      const geminiResponse = this.convertToGeminiResponse(response);
      
      // Update history
      this.updateHistoryFromResponse(params, response);
      
      // Update stats
      const responseTime = Date.now() - startTime;
      this.updateStats(
        response.usage.input_tokens,
        response.usage.output_tokens,
        responseTime,
      );
      
      return geminiResponse;
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapClaudeError(error);
    }
  }

  async sendMessageStream(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    
    try {
      const claudeRequest = this.convertToClaudeRequest(params, true);
      const stream = this.makeClaudeStreamRequest(claudeRequest);
      
      return this.wrapStreamResponse(stream, params, startTime);
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapClaudeError(error);
    }
  }

  async generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model?: string,
    config?: ChatGenerationConfig,
  ): Promise<Record<string, unknown>> {
    // Claude doesn't have native JSON schema support, so we use a system prompt
    const systemPrompt = `You must respond with valid JSON that matches this schema: ${JSON.stringify(schema)}. Only return the JSON, no other text.`;
    
    const messages = this.convertGeminiContentsToClaudeMessages(contents);
    const request: ClaudeRequest = {
      model: model || this.model,
      messages,
      max_tokens: config?.maxOutputTokens || 4096,
      temperature: config?.temperature,
      top_p: config?.topP,
      top_k: config?.topK,
      system: systemPrompt,
    };

    try {
      const response = await this.makeClaudeRequest(request, abortSignal);
      const textContent = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');
      
      return JSON.parse(textContent);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ChatSessionError(
          'Failed to parse JSON response from Claude',
          this.sessionId,
          this.provider,
          'JSON_PARSE_ERROR',
        );
      }
      throw this.wrapClaudeError(error);
    }
  }

  async generateContent(
    contents: Content[],
    config: ChatGenerationConfig,
    abortSignal: AbortSignal,
    model?: string,
  ): Promise<GenerateContentResponse> {
    const messages = this.convertGeminiContentsToClaudeMessages(contents);
    const request: ClaudeRequest = {
      model: model || this.model,
      messages,
      max_tokens: config.maxOutputTokens || 4096,
      temperature: config.temperature,
      top_p: config.topP,
      top_k: config.topK,
      stop_sequences: config.stopSequences,
      system: config.systemInstruction?.text || this.systemPrompt,
    };

    try {
      const response = await this.makeClaudeRequest(request, abortSignal);
      return this.convertToGeminiResponse(response);
    } catch (error) {
      throw this.wrapClaudeError(error);
    }
  }

  async generateEmbedding(texts: string[]): Promise<number[][]> {
    // Claude doesn't support embeddings - could integrate with a separate service
    throw new ChatSessionError(
      'Claude does not support embedding generation',
      this.sessionId,
      this.provider,
      'UNSUPPORTED_OPERATION',
    );
  }

  async countTokens(contents: Content[]): Promise<{ totalTokens: number }> {
    // Claude doesn't have a token counting API, so we estimate
    const text = contents
      .flatMap(c => c.parts || [])
      .filter(p => p.text)
      .map(p => p.text)
      .join(' ');
    
    // Rough approximation: 1 token ≈ 4 characters for English text
    const estimatedTokens = Math.ceil(text.length / 4);
    
    return { totalTokens: estimatedTokens };
  }

  getCapabilities(): ChatSessionCapabilities {
    return {
      supportsStreaming: true,
      supportsTools: true,
      supportsImages: true,
      supportsSystemPrompts: true,
      supportsJsonSchema: false, // Claude doesn't have native JSON schema support
      supportsThinking: false,
      maxContextLength: this.getModelContextLength(),
      supportedMimeTypes: [
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ],
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const testRequest: ClaudeRequest = {
        model: this.model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
      };
      
      await this.makeClaudeRequest(testRequest);
      return true;
    } catch (error) {
      return false;
    }
  }

  async reset(): Promise<void> {
    this.clearHistory();
    
    // Reset stats
    this.stats.messageCount = 0;
    this.stats.tokenCount = { input: 0, output: 0, total: 0 };
    this.stats.toolCallCount = 0;
    this.stats.errorCount = 0;
    this.stats.averageResponseTime = 0;
    this.startTime = Date.now();
  }

  async dispose(): Promise<void> {
    this.clearHistory();
  }

  // Private helper methods

  /**
   * Convert ChatMessageParams to Claude request format
   */
  private convertToClaudeRequest(
    params: ChatMessageParams,
    stream: boolean,
  ): ClaudeRequest {
    const messages = this.getClaudeMessages();
    
    // Add the new message
    const newMessage = this.convertMessageToClaudeFormat(params.message);
    messages.push(newMessage);

    return {
      model: this.model,
      messages,
      max_tokens: params.config?.maxOutputTokens || 4096,
      temperature: params.config?.temperature,
      top_p: params.config?.topP,
      top_k: params.config?.topK,
      stop_sequences: params.config?.stopSequences,
      system: params.config?.systemInstruction?.text || this.systemPrompt,
      stream,
      tools: this.convertToolsToClaudeFormat(params.config?.tools || this.tools),
    };
  }

  /**
   * Convert message to Claude format
   */
  private convertMessageToClaudeFormat(
    message: string | Content | Part[],
  ): ClaudeMessage {
    if (typeof message === 'string') {
      return { role: 'user', content: message };
    }

    if (Array.isArray(message)) {
      // Parts array
      const content = message.map(part => {
        if (part.text) {
          return { type: 'text' as const, text: part.text };
        }
        if (part.inlineData) {
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: part.inlineData.mimeType,
              data: part.inlineData.data,
            },
          };
        }
        return { type: 'text' as const, text: JSON.stringify(part) };
      });

      return { role: 'user', content };
    }

    // Content object
    const content = (message.parts || []).map(part => {
      if (part.text) {
        return { type: 'text' as const, text: part.text };
      }
      if (part.inlineData) {
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: part.inlineData.mimeType,
            data: part.inlineData.data,
          },
        };
      }
      return { type: 'text' as const, text: JSON.stringify(part) };
    });

    return { role: message.role === 'model' ? 'assistant' : 'user', content };
  }

  /**
   * Get Claude messages from current history
   */
  private getClaudeMessages(): ClaudeMessage[] {
    return this.history.map(content => this.convertMessageToClaudeFormat(content));
  }

  /**
   * Convert Gemini contents to Claude messages
   */
  private convertGeminiContentsToClaudeMessages(contents: Content[]): ClaudeMessage[] {
    return contents.map(content => this.convertMessageToClaudeFormat(content));
  }

  /**
   * Convert tools to Claude format
   */
  private convertToolsToClaudeFormat(tools: Tool[]): any[] {
    return tools.flatMap(tool => 
      tool.functionDeclarations?.map(func => ({
        name: func.name,
        description: func.description,
        input_schema: func.parameters,
      })) || []
    );
  }

  /**
   * Make request to Claude API
   */
  private async makeClaudeRequest(
    request: ClaudeRequest,
    abortSignal?: AbortSignal,
  ): Promise<ClaudeResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    return response.json();
  }

  /**
   * Make streaming request to Claude API
   */
  private async *makeClaudeStreamRequest(
    request: ClaudeRequest,
  ): AsyncGenerator<ClaudeResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta') {
                // Convert streaming chunk to full response format
                yield {
                  id: parsed.id || 'stream',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'text', text: parsed.delta?.text || '' }],
                  model: request.model,
                  stop_reason: 'end_turn',
                  usage: { input_tokens: 0, output_tokens: 0 },
                } as ClaudeResponse;
              }
            } catch (error) {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Convert Claude response to Gemini format
   */
  private convertToGeminiResponse(response: ClaudeResponse): GenerateContentResponse {
    const parts = response.content.map(content => {
      if (content.type === 'text') {
        return { text: content.text || '' };
      }
      if (content.type === 'tool_use') {
        return {
          functionCall: {
            name: content.name || '',
            args: content.input || {},
          },
        };
      }
      return { text: JSON.stringify(content) };
    });

    return {
      candidates: [{
        content: {
          role: 'model',
          parts,
        },
        finishReason: this.convertStopReason(response.stop_reason),
        index: 0,
      }],
      usageMetadata: {
        promptTokenCount: response.usage.input_tokens,
        candidatesTokenCount: response.usage.output_tokens,
        totalTokenCount: response.usage.input_tokens + response.usage.output_tokens,
      },
      modelVersion: response.model,
    } as GenerateContentResponse;
  }

  /**
   * Convert Claude stop reason to Gemini format
   */
  private convertStopReason(stopReason: string): any {
    switch (stopReason) {
      case 'end_turn':
        return 'STOP';
      case 'max_tokens':
        return 'MAX_TOKENS';
      case 'stop_sequence':
        return 'STOP';
      case 'tool_use':
        return 'STOP';
      default:
        return 'OTHER';
    }
  }

  /**
   * Update history from Claude response
   */
  private updateHistoryFromResponse(
    params: ChatMessageParams,
    response: ClaudeResponse,
  ): void {
    // Add user message
    const userContent: Content = {
      role: 'user',
      parts: this.convertMessageToParts(params.message),
    };
    this.addHistory(userContent);

    // Add assistant response
    const assistantContent: Content = {
      role: 'model',
      parts: response.content.map(content => {
        if (content.type === 'text') {
          return { text: content.text || '' };
        }
        if (content.type === 'tool_use') {
          return {
            functionCall: {
              name: content.name || '',
              args: content.input || {},
            },
          };
        }
        return { text: JSON.stringify(content) };
      }),
    };
    this.addHistory(assistantContent);
  }

  /**
   * Convert message to parts
   */
  private convertMessageToParts(message: string | Content | Part[]): Part[] {
    if (typeof message === 'string') {
      return [{ text: message }];
    }

    if (Array.isArray(message)) {
      return message;
    }

    return message.parts || [];
  }

  /**
   * Wrap streaming response
   */
  private async *wrapStreamResponse(
    stream: AsyncGenerator<ClaudeResponse>,
    params: ChatMessageParams,
    startTime: number,
  ): AsyncGenerator<GenerateContentResponse> {
    const chunks: GenerateContentResponse[] = [];
    let fullResponse: ClaudeResponse | null = null;
    
    try {
      for await (const claudeResponse of stream) {
        const geminiResponse = this.convertToGeminiResponse(claudeResponse);
        chunks.push(geminiResponse);
        fullResponse = claudeResponse;
        yield geminiResponse;
      }
      
      // Update stats and history after stream completes
      if (fullResponse) {
        const responseTime = Date.now() - startTime;
        this.updateStats(
          fullResponse.usage.input_tokens,
          fullResponse.usage.output_tokens,
          responseTime,
        );
        
        this.updateHistoryFromResponse(params, fullResponse);
      }
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapClaudeError(error);
    }
  }

  /**
   * Wrap Claude errors in ChatSession format
   */
  private wrapClaudeError(error: any): ChatSessionError {
    if (error instanceof ChatSessionError) {
      return error;
    }
    
    const message = error?.message || 'Unknown Claude error';
    let ErrorClass = ChatSessionError;
    let code = 'CLAUDE_ERROR';
    
    if (message.includes('401') || message.includes('invalid_api_key')) {
      code = 'AUTHENTICATION_ERROR';
    } else if (message.includes('429') || message.includes('rate_limit')) {
      ErrorClass = ChatSessionRateLimitError;
      code = 'RATE_LIMIT_ERROR';
    } else if (message.includes('timeout')) {
      ErrorClass = ChatSessionTimeoutError;
      code = 'TIMEOUT';
    }
    
    if (ErrorClass === ChatSessionRateLimitError) {
      return new ErrorClass(this.sessionId, this.provider);
    } else if (ErrorClass === ChatSessionTimeoutError) {
      return new ErrorClass(this.sessionId, this.provider);
    }
    
    return new ChatSessionError(message, this.sessionId, this.provider, code);
  }

  /**
   * Get context length for the current model
   */
  private getModelContextLength(): number {
    const model = this.model.toLowerCase();
    
    if (model.includes('claude-3.5')) {
      return 200000; // 200k tokens
    } else if (model.includes('claude-3')) {
      return 200000; // 200k tokens
    } else if (model.includes('claude-2')) {
      return 100000; // 100k tokens
    }
    
    return 100000; // Default fallback
  }
}

/**
 * Factory for creating Claude chat sessions
 */
export class ClaudeChatSessionFactory {
  constructor(private config: Config) {}

  async createSession(
    provider: AIProvider,
    model: string,
    config?: Partial<ChatGenerationConfig>,
  ): Promise<ClaudeChatSession> {
    if (provider !== AIProvider.CLAUDE) {
      throw new ChatSessionError(
        `Cannot create ${provider} session with Claude factory`,
        'unknown',
        provider,
        'INVALID_PROVIDER',
      );
    }

    const sessionId = `claude-${model}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const apiKey = this.config.get('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
    const endpoint = this.config.get('CLAUDE_ENDPOINT') || 'https://api.anthropic.com/v1/messages';
    
    const session = new ClaudeChatSession(sessionId, model, this.config, apiKey, endpoint);
    
    return session;
  }

  getSupportedProviders(): AIProvider[] {
    return [AIProvider.CLAUDE];
  }

  async getAvailableModels(): Promise<string[]> {
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
  }
}