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
} from '../../core/chatSession.js';
import { GeminiChat } from '../../core/geminiChat.js';
import { GeminiClient } from '../../core/client.js';
import { AIProvider } from '../types.js';
import { Config } from '../../config/config.js';
import { ContentGenerator } from '../../core/contentGenerator.js';

/**
 * Gemini-specific implementation of ChatSession that wraps existing GeminiClient/GeminiChat
 */
export class GeminiChatSession extends BaseChatSession {
  private geminiClient: GeminiClient;
  private geminiChat: GeminiChat | null = null;

  constructor(
    sessionId: string,
    model: string,
    private config: Config,
    private contentGenerator: ContentGenerator,
  ) {
    super(sessionId, AIProvider.GEMINI, model);
    this.geminiClient = new GeminiClient(config);
  }

  /**
   * Initialize the Gemini session
   */
  async initialize(): Promise<void> {
    if (!this.geminiClient.isInitialized()) {
      await this.geminiClient.initialize({
        authType: this.config.getContentGeneratorConfig()?.authType,
        apiKey: this.config.getContentGeneratorConfig()?.apiKey,
      });
    }
    
    this.geminiChat = this.geminiClient.getChat();
  }

  /**
   * Ensure session is initialized
   */
  private async ensureInitialized(): Promise<GeminiChat> {
    if (!this.geminiChat) {
      await this.initialize();
    }
    
    if (!this.geminiChat) {
      throw new ChatSessionError(
        'Failed to initialize Gemini chat session',
        this.sessionId,
        this.provider,
        'INITIALIZATION_FAILED',
      );
    }
    
    return this.geminiChat;
  }

  async sendMessage(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    
    try {
      const geminiChat = await this.ensureInitialized();
      
      // Convert ChatMessageParams to GeminiChat format
      const geminiParams = this.convertToGeminiParams(params);
      
      const response = await geminiChat.sendMessage(geminiParams, promptId);
      
      // Update stats
      const responseTime = Date.now() - startTime;
      this.updateStats(
        response.usageMetadata?.promptTokenCount || 0,
        response.usageMetadata?.candidatesTokenCount || 0,
        responseTime,
      );
      
      // Update local history from Gemini chat
      this.syncHistoryFromGemini();
      
      return response;
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapGeminiError(error);
    }
  }

  async sendMessageStream(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    
    try {
      const geminiChat = await this.ensureInitialized();
      
      // Convert ChatMessageParams to GeminiChat format
      const geminiParams = this.convertToGeminiParams(params);
      const stream = await geminiChat.sendMessageStream(geminiParams, promptId);
      
      return this.wrapStreamResponse(stream, startTime);
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapGeminiError(error);
    }
  }

  async generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model?: string,
    config?: ChatGenerationConfig,
  ): Promise<Record<string, unknown>> {
    try {
      const geminiConfig = this.convertToGeminiConfig(config);
      return await this.geminiClient.generateJson(
        contents,
        schema,
        abortSignal,
        model,
        geminiConfig,
      );
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapGeminiError(error);
    }
  }

  async generateContent(
    contents: Content[],
    config: ChatGenerationConfig,
    abortSignal: AbortSignal,
    model?: string,
  ): Promise<GenerateContentResponse> {
    try {
      const geminiConfig = this.convertToGeminiConfig(config);
      return await this.geminiClient.generateContent(
        contents,
        geminiConfig,
        abortSignal,
        model,
      );
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapGeminiError(error);
    }
  }

  async generateEmbedding(texts: string[]): Promise<number[][]> {
    try {
      return await this.geminiClient.generateEmbedding(texts);
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapGeminiError(error);
    }
  }

  async countTokens(contents: Content[]): Promise<{ totalTokens: number }> {
    try {
      const contentGenerator = this.geminiClient.getContentGenerator();
      const result = await contentGenerator.countTokens({
        model: this.model,
        contents,
      });
      return { totalTokens: result.totalTokens || 0 };
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapGeminiError(error);
    }
  }

  getCapabilities(): ChatSessionCapabilities {
    return {
      supportsStreaming: true,
      supportsTools: true,
      supportsImages: true,
      supportsSystemPrompts: true,
      supportsJsonSchema: true,
      supportsThinking: this.model.startsWith('gemini-2.5'),
      maxContextLength: this.getModelContextLength(),
      supportedMimeTypes: [
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'application/pdf',
        'text/csv',
        'text/html',
        'text/javascript',
        'text/css',
        'application/json',
      ],
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.geminiChat) {
        await this.initialize();
      }
      
      // Simple health check - try to count tokens for empty content
      await this.countTokens([]);
      return true;
    } catch (error) {
      return false;
    }
  }

  async reset(): Promise<void> {
    try {
      await this.geminiClient.resetChat();
      this.geminiChat = this.geminiClient.getChat();
      this.clearHistory();
      
      // Reset stats
      this.stats.messageCount = 0;
      this.stats.tokenCount = { input: 0, output: 0, total: 0 };
      this.stats.toolCallCount = 0;
      this.stats.errorCount = 0;
      this.stats.averageResponseTime = 0;
      this.startTime = Date.now();
    } catch (error) {
      throw this.wrapGeminiError(error);
    }
  }

  async dispose(): Promise<void> {
    // Clean up any resources
    this.geminiChat = null;
    this.clearHistory();
  }

  // Override history methods to sync with Gemini chat

  getHistory(curated: boolean = false): Content[] {
    if (this.geminiChat) {
      return this.geminiChat.getHistory(curated);
    }
    return super.getHistory(curated);
  }

  setHistory(history: Content[]): void {
    if (this.geminiChat) {
      this.geminiChat.setHistory(history);
    }
    super.setHistory(history);
  }

  clearHistory(): void {
    if (this.geminiChat) {
      this.geminiChat.clearHistory();
    }
    super.clearHistory();
  }

  addHistory(content: Content): void {
    if (this.geminiChat) {
      this.geminiChat.addHistory(content);
    }
    super.addHistory(content);
  }

  setTools(tools: Tool[]): void {
    if (this.geminiChat) {
      this.geminiChat.setTools(tools);
    }
    super.setTools(tools);
  }

  // Private helper methods

  /**
   * Convert ChatMessageParams to Gemini format
   */
  private convertToGeminiParams(params: ChatMessageParams): any {
    let message: any;
    
    if (typeof params.message === 'string') {
      message = { text: params.message };
    } else if (Array.isArray(params.message)) {
      // Parts array
      message = params.message;
    } else {
      // Content object
      message = params.message.parts || params.message;
    }

    return {
      message,
      config: this.convertToGeminiConfig(params.config),
    };
  }

  /**
   * Convert ChatGenerationConfig to Gemini format
   */
  private convertToGeminiConfig(config?: ChatGenerationConfig): any {
    if (!config) {
      return {};
    }

    return {
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      maxOutputTokens: config.maxOutputTokens,
      candidateCount: config.candidateCount,
      stopSequences: config.stopSequences,
      systemInstruction: config.systemInstruction,
      tools: config.tools,
      responseSchema: config.responseSchema,
      responseMimeType: config.responseMimeType,
      thinkingConfig: config.thinkingConfig,
    };
  }

  /**
   * Wrap streaming response to track stats
   */
  private async *wrapStreamResponse(
    stream: AsyncGenerator<GenerateContentResponse>,
    startTime: number,
  ): AsyncGenerator<GenerateContentResponse> {
    const chunks: GenerateContentResponse[] = [];
    
    try {
      for await (const chunk of stream) {
        chunks.push(chunk);
        yield chunk;
      }
      
      // Update stats after stream completes
      const responseTime = Date.now() - startTime;
      const finalMetadata = this.getFinalUsageMetadata(chunks);
      
      this.updateStats(
        finalMetadata?.promptTokenCount || 0,
        finalMetadata?.candidatesTokenCount || 0,
        responseTime,
      );
      
      // Sync history
      this.syncHistoryFromGemini();
    } catch (error) {
      this.incrementErrorCount();
      throw this.wrapGeminiError(error);
    }
  }

  /**
   * Sync local history with Gemini chat
   */
  private syncHistoryFromGemini(): void {
    if (this.geminiChat) {
      this.history = this.geminiChat.getHistory();
    }
  }

  /**
   * Wrap Gemini errors in ChatSession format
   */
  private wrapGeminiError(error: any): ChatSessionError {
    if (error instanceof ChatSessionError) {
      return error;
    }
    
    const message = error?.message || 'Unknown Gemini error';
    let code = 'GEMINI_ERROR';
    
    if (message.includes('401') || message.includes('Unauthorized')) {
      code = 'AUTHENTICATION_ERROR';
    } else if (message.includes('429') || message.includes('quota')) {
      code = 'RATE_LIMIT_ERROR';
    } else if (message.includes('timeout')) {
      code = 'TIMEOUT';
    }
    
    return new ChatSessionError(message, this.sessionId, this.provider, code);
  }

  /**
   * Get context length for the current model
   */
  private getModelContextLength(): number {
    const model = this.model.toLowerCase();
    
    if (model.includes('gemini-2.0') || model.includes('gemini-2.5')) {
      return 2000000; // 2M tokens
    } else if (model.includes('gemini-1.5')) {
      return 1000000; // 1M tokens
    } else if (model.includes('flash')) {
      return 1000000; // 1M tokens
    }
    
    return 32000; // Default fallback
  }
}

/**
 * Factory for creating Gemini chat sessions
 */
export class GeminiChatSessionFactory {
  constructor(private config: Config) {}

  async createSession(
    provider: AIProvider,
    model: string,
    config?: Partial<ChatGenerationConfig>,
  ): Promise<GeminiChatSession> {
    if (provider !== AIProvider.GEMINI) {
      throw new ChatSessionError(
        `Cannot create ${provider} session with Gemini factory`,
        'unknown',
        provider,
        'INVALID_PROVIDER',
      );
    }

    const sessionId = `gemini-${model}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const contentGenerator = await this.createContentGenerator();
    
    const session = new GeminiChatSession(sessionId, model, this.config, contentGenerator);
    await session.initialize();
    
    return session;
  }

  getSupportedProviders(): AIProvider[] {
    return [AIProvider.GEMINI];
  }

  async getAvailableModels(): Promise<string[]> {
    // Return commonly available Gemini models
    return [
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.0-pro',
    ];
  }

  private async createContentGenerator(): Promise<ContentGenerator> {
    const { createContentGenerator } = await import('../../core/contentGenerator.js');
    return createContentGenerator(
      this.config.getContentGeneratorConfig(),
      this.config,
      this.config.getSessionId(),
    );
  }
}