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
} from '../../core/chatSession.js';
import { AIProvider } from '../types.js';
import { Config } from '../../config/config.js';

/**
 * Ollama API message format
 */
interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[]; // Base64 encoded images
}

/**
 * Ollama API request format
 */
interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    stop?: string[];
  };
  system?: string;
}

/**
 * Ollama API response format
 */
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

/**
 * Ollama models list response
 */
interface OllamaModelsResponse {
  models: Array<{
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
  }>;
}

/**
 * Ollama-specific implementation of ChatSession
 */
export class OllamaChatSession extends BaseChatSession {
  private endpoint: string;
  private timeout: number;
  private systemPrompt?: string;

  constructor(
    sessionId: string,
    model: string,
    private config: Config,
    endpoint?: string,
    timeout: number = 120000, // 2 minutes default
  ) {
    super(sessionId, AIProvider.OLLAMA, model);
    
    this.endpoint = endpoint || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.timeout = timeout;
    
    // Remove trailing slash
    if (this.endpoint.endsWith('/')) {
      this.endpoint = this.endpoint.slice(0, -1);
    }
  }

  async sendMessage(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    
    try {
      const ollamaRequest = this.convertToOllamaRequest(params, false);
      const response = await this.makeOllamaRequest(ollamaRequest);
      
      // Convert Ollama response to Gemini format
      const geminiResponse = this.convertToGeminiResponse(response);
      
      // Update history
      this.updateHistoryFromResponse(params, response);
      
      // Update stats (Ollama doesn't provide token counts, so we estimate)
      const responseTime = Date.now() - startTime;
      const inputTokens = this.estimateTokens(this.getMessagesText(ollamaRequest.messages));
      const outputTokens = this.estimateTokens(response.message.content);
      
      this.updateStats(inputTokens, outputTokens, responseTime);
      
      return geminiResponse;
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapOllamaError(error);
    }
  }

  async sendMessageStream(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    
    try {
      const ollamaRequest = this.convertToOllamaRequest(params, true);
      const stream = this.makeOllamaStreamRequest(ollamaRequest);
      
      return this.wrapStreamResponse(stream, params, startTime);
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapOllamaError(error);
    }
  }

  async generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model?: string,
    config?: ChatGenerationConfig,
  ): Promise<Record<string, unknown>> {
    // Ollama doesn't have native JSON schema support, so we use a system prompt
    const systemPrompt = `You must respond with valid JSON that matches this schema: ${JSON.stringify(schema)}. Only return the JSON, no other text.`;
    
    const messages = this.convertGeminiContentsToOllamaMessages(contents);
    const request: OllamaRequest = {
      model: model || this.model,
      messages,
      system: systemPrompt,
      options: {
        temperature: config?.temperature,
        top_p: config?.topP,
        top_k: config?.topK,
        max_tokens: config?.maxOutputTokens,
        stop: config?.stopSequences,
      },
    };

    try {
      const response = await this.makeOllamaRequest(request, abortSignal);
      return JSON.parse(response.message.content);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ChatSessionError(
          'Failed to parse JSON response from Ollama',
          this.sessionId,
          this.provider,
          'JSON_PARSE_ERROR',
        );
      }
      throw this.wrapOllamaError(error);
    }
  }

  async generateContent(
    contents: Content[],
    config: ChatGenerationConfig,
    abortSignal: AbortSignal,
    model?: string,
  ): Promise<GenerateContentResponse> {
    const messages = this.convertGeminiContentsToOllamaMessages(contents);
    const request: OllamaRequest = {
      model: model || this.model,
      messages,
      system: config.systemInstruction?.text || this.systemPrompt,
      options: {
        temperature: config.temperature,
        top_p: config.topP,
        top_k: config.topK,
        max_tokens: config.maxOutputTokens,
        stop: config.stopSequences,
      },
    };

    try {
      const response = await this.makeOllamaRequest(request, abortSignal);
      return this.convertToGeminiResponse(response);
    } catch (error) {
      throw this.wrapOllamaError(error);
    }
  }

  async generateEmbedding(texts: string[]): Promise<number[][]> {
    // Ollama supports embeddings for some models
    const embeddings: number[][] = [];
    
    for (const text of texts) {
      try {
        const response = await fetch(`${this.endpoint}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: text,
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama embeddings API error: ${response.status}`);
        }

        const data = await response.json();
        embeddings.push(data.embedding || []);
      } catch (error) {
        throw new ChatSessionError(
          `Failed to generate embedding: ${error}`,
          this.sessionId,
          this.provider,
          'EMBEDDING_ERROR',
        );
      }
    }

    return embeddings;
  }

  async countTokens(contents: Content[]): Promise<{ totalTokens: number }> {
    // Ollama doesn't have a token counting API, so we estimate
    const text = contents
      .flatMap(c => c.parts || [])
      .filter(p => p.text)
      .map(p => p.text)
      .join(' ');
    
    const estimatedTokens = this.estimateTokens(text);
    return { totalTokens: estimatedTokens };
  }

  getCapabilities(): ChatSessionCapabilities {
    const isVisionModel = this.model.toLowerCase().includes('llava') || 
                         this.model.toLowerCase().includes('vision');
    
    return {
      supportsStreaming: true,
      supportsTools: false, // Most Ollama models don't support function calling
      supportsImages: isVisionModel,
      supportsSystemPrompts: true,
      supportsJsonSchema: false,
      supportsThinking: false,
      maxContextLength: this.getModelContextLength(),
      supportedMimeTypes: isVisionModel ? [
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ] : ['text/plain'],
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Check if Ollama server is running
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) {
        return false;
      }

      // Check if our model is available
      const data: OllamaModelsResponse = await response.json();
      const modelExists = data.models.some(m => m.name === this.model);
      
      return modelExists;
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
   * Convert ChatMessageParams to Ollama request format
   */
  private convertToOllamaRequest(
    params: ChatMessageParams,
    stream: boolean,
  ): OllamaRequest {
    const messages = this.getOllamaMessages();
    
    // Add the new message
    const newMessage = this.convertMessageToOllamaFormat(params.message);
    messages.push(newMessage);

    return {
      model: this.model,
      messages,
      stream,
      system: params.config?.systemInstruction?.text || this.systemPrompt,
      options: {
        temperature: params.config?.temperature,
        top_p: params.config?.topP,
        top_k: params.config?.topK,
        max_tokens: params.config?.maxOutputTokens,
        stop: params.config?.stopSequences,
      },
    };
  }

  /**
   * Convert message to Ollama format
   */
  private convertMessageToOllamaFormat(
    message: string | Content | Part[],
  ): OllamaMessage {
    if (typeof message === 'string') {
      return { role: 'user', content: message };
    }

    let content = '';
    let images: string[] = [];

    if (Array.isArray(message)) {
      // Parts array
      for (const part of message) {
        if (part.text) {
          content += part.text;
        }
        if (part.inlineData) {
          images.push(part.inlineData.data);
        }
      }
    } else {
      // Content object
      const role = message.role === 'model' ? 'assistant' : 'user';
      
      for (const part of message.parts || []) {
        if (part.text) {
          content += part.text;
        }
        if (part.inlineData) {
          images.push(part.inlineData.data);
        }
      }

      return {
        role: role as 'user' | 'assistant',
        content,
        images: images.length > 0 ? images : undefined,
      };
    }

    return {
      role: 'user',
      content,
      images: images.length > 0 ? images : undefined,
    };
  }

  /**
   * Get Ollama messages from current history
   */
  private getOllamaMessages(): OllamaMessage[] {
    return this.history.map(content => this.convertMessageToOllamaFormat(content));
  }

  /**
   * Convert Gemini contents to Ollama messages
   */
  private convertGeminiContentsToOllamaMessages(contents: Content[]): OllamaMessage[] {
    return contents.map(content => this.convertMessageToOllamaFormat(content));
  }

  /**
   * Make request to Ollama API
   */
  private async makeOllamaRequest(
    request: OllamaRequest,
    abortSignal?: AbortSignal,
  ): Promise<OllamaResponse> {
    const timeoutSignal = AbortSignal.timeout(this.timeout);
    const combinedSignal = abortSignal 
      ? AbortSignal.any([abortSignal, timeoutSignal])
      : timeoutSignal;

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Make streaming request to Ollama API
   */
  private async *makeOllamaStreamRequest(
    request: OllamaRequest,
  ): AsyncGenerator<OllamaResponse> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const parsed: OllamaResponse = JSON.parse(line);
            yield parsed;
            
            if (parsed.done) {
              return;
            }
          } catch (error) {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Convert Ollama response to Gemini format
   */
  private convertToGeminiResponse(response: OllamaResponse): GenerateContentResponse {
    return {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: response.message.content }],
        },
        finishReason: response.done ? 'STOP' : 'OTHER',
        index: 0,
      }],
      usageMetadata: {
        promptTokenCount: response.prompt_eval_count || this.estimateTokens(''),
        candidatesTokenCount: response.eval_count || this.estimateTokens(response.message.content),
        totalTokenCount: (response.prompt_eval_count || 0) + (response.eval_count || 0),
      },
      modelVersion: response.model,
    } as GenerateContentResponse;
  }

  /**
   * Update history from Ollama response
   */
  private updateHistoryFromResponse(
    params: ChatMessageParams,
    response: OllamaResponse,
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
      parts: [{ text: response.message.content }],
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
   * Get text content from messages
   */
  private getMessagesText(messages: OllamaMessage[]): string {
    return messages.map(m => m.content).join(' ');
  }

  /**
   * Wrap streaming response
   */
  private async *wrapStreamResponse(
    stream: AsyncGenerator<OllamaResponse>,
    params: ChatMessageParams,
    startTime: number,
  ): AsyncGenerator<GenerateContentResponse> {
    const chunks: GenerateContentResponse[] = [];
    let fullContent = '';
    let lastResponse: OllamaResponse | null = null;
    
    try {
      for await (const ollamaResponse of stream) {
        const geminiResponse = this.convertToGeminiResponse(ollamaResponse);
        chunks.push(geminiResponse);
        fullContent += ollamaResponse.message.content;
        lastResponse = ollamaResponse;
        yield geminiResponse;
      }
      
      // Update stats and history after stream completes
      if (lastResponse) {
        const responseTime = Date.now() - startTime;
        const inputTokens = lastResponse.prompt_eval_count || this.estimateTokens('');
        const outputTokens = lastResponse.eval_count || this.estimateTokens(fullContent);
        
        this.updateStats(inputTokens, outputTokens, responseTime);
        
        // Create a complete response for history
        const completeResponse: OllamaResponse = {
          ...lastResponse,
          message: { role: 'assistant', content: fullContent },
        };
        
        this.updateHistoryFromResponse(params, completeResponse);
      }
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapOllamaError(error);
    }
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    // Rough approximation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Wrap Ollama errors in ChatSession format
   */
  private wrapOllamaError(error: any): ChatSessionError {
    if (error instanceof ChatSessionError) {
      return error;
    }
    
    const message = error?.message || 'Unknown Ollama error';
    let ErrorClass = ChatSessionError;
    let code = 'OLLAMA_ERROR';
    
    if (message.includes('timeout') || message.includes('TimeoutError')) {
      ErrorClass = ChatSessionTimeoutError;
      code = 'TIMEOUT';
    } else if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      code = 'CONNECTION_ERROR';
    } else if (message.includes('404')) {
      code = 'MODEL_NOT_FOUND';
    }
    
    if (ErrorClass === ChatSessionTimeoutError) {
      return new ErrorClass(this.sessionId, this.provider);
    }
    
    return new ChatSessionError(message, this.sessionId, this.provider, code);
  }

  /**
   * Get context length for the current model
   */
  private getModelContextLength(): number {
    const model = this.model.toLowerCase();
    
    // Common Ollama model context lengths
    if (model.includes('llama2') || model.includes('llama-2')) {
      return 4096;
    } else if (model.includes('llama3') || model.includes('llama-3')) {
      return 8192;
    } else if (model.includes('mistral')) {
      return 8192;
    } else if (model.includes('codellama')) {
      return 16384;
    } else if (model.includes('llava')) {
      return 4096;
    }
    
    return 4096; // Default fallback
  }
}

/**
 * Factory for creating Ollama chat sessions
 */
export class OllamaChatSessionFactory {
  constructor(private config: Config) {}

  async createSession(
    provider: AIProvider,
    model: string,
    config?: Partial<ChatGenerationConfig>,
  ): Promise<OllamaChatSession> {
    if (provider !== AIProvider.OLLAMA) {
      throw new ChatSessionError(
        `Cannot create ${provider} session with Ollama factory`,
        'unknown',
        provider,
        'INVALID_PROVIDER',
      );
    }

    const sessionId = `ollama-${model}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const endpoint = this.config.get('OLLAMA_HOST') || 
                    this.config.get('OLLAMA_ENDPOINT') || 
                    process.env.OLLAMA_HOST || 
                    'http://localhost:11434';
    
    const session = new OllamaChatSession(sessionId, model, this.config, endpoint);
    
    // Test if the session is healthy before returning
    const isHealthy = await session.isHealthy();
    if (!isHealthy) {
      throw new ChatSessionError(
        `Ollama model '${model}' is not available at ${endpoint}`,
        sessionId,
        provider,
        'MODEL_NOT_AVAILABLE',
      );
    }
    
    return session;
  }

  getSupportedProviders(): AIProvider[] {
    return [AIProvider.OLLAMA];
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const endpoint = this.config.get('OLLAMA_HOST') || 
                      this.config.get('OLLAMA_ENDPOINT') || 
                      process.env.OLLAMA_HOST || 
                      'http://localhost:11434';

      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return [];
      }

      const data: OllamaModelsResponse = await response.json();
      return data.models.map(model => model.name);
    } catch (error) {
      console.warn('Failed to fetch Ollama models:', error);
      return [
        'llama2',
        'llama3',
        'mistral',
        'codellama',
        'llava',
      ];
    }
  }
}