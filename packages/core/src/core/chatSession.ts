/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  Tool,
  Part,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  SchemaUnion,
} from '@google/genai';
import { AIProvider } from '../providers/types.js';

/**
 * Provider-agnostic chat session interface that abstracts away provider-specific implementations
 */
export interface ChatSession {
  readonly sessionId: string;
  readonly provider: AIProvider;
  readonly model: string;

  /**
   * Send a message and get a response
   */
  sendMessage(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<GenerateContentResponse>;

  /**
   * Send a message and get a streaming response
   */
  sendMessageStream(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  /**
   * Get conversation history
   * @param curated - Whether to return curated (valid) history or comprehensive history
   */
  getHistory(curated?: boolean): Content[];

  /**
   * Set conversation history
   */
  setHistory(history: Content[]): void;

  /**
   * Clear conversation history
   */
  clearHistory(): void;

  /**
   * Add content to conversation history
   */
  addHistory(content: Content): void;

  /**
   * Set tools available for this session
   */
  setTools(tools: Tool[]): void;

  /**
   * Generate JSON response with schema validation
   */
  generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model?: string,
    config?: ChatGenerationConfig,
  ): Promise<Record<string, unknown>>;

  /**
   * Generate content with custom configuration
   */
  generateContent(
    contents: Content[],
    config: ChatGenerationConfig,
    abortSignal: AbortSignal,
    model?: string,
  ): Promise<GenerateContentResponse>;

  /**
   * Generate embeddings for text content
   */
  generateEmbedding(texts: string[]): Promise<number[][]>;

  /**
   * Count tokens for given content
   */
  countTokens(contents: Content[]): Promise<{ totalTokens: number }>;

  /**
   * Get final usage metadata from response chunks (for streaming)
   */
  getFinalUsageMetadata(
    chunks: GenerateContentResponse[],
  ): GenerateContentResponseUsageMetadata | undefined;

  /**
   * Test if the session is healthy and can process requests
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get provider-specific capabilities
   */
  getCapabilities(): ChatSessionCapabilities;

  /**
   * Get current session statistics
   */
  getStats(): ChatSessionStats;

  /**
   * Reset the session to initial state
   */
  reset(): Promise<void>;

  /**
   * Clean up resources when session is no longer needed
   */
  dispose(): Promise<void>;
}

/**
 * Parameters for sending chat messages
 */
export interface ChatMessageParams {
  message: string | Content | Part[];
  config?: ChatGenerationConfig;
}

/**
 * Provider-agnostic generation configuration
 */
export interface ChatGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  stopSequences?: string[];
  systemInstruction?: { text: string } | Content;
  tools?: Tool[];
  responseSchema?: SchemaUnion;
  responseMimeType?: string;
  thinkingConfig?: {
    includeThoughts: boolean;
  };
}

/**
 * Session capabilities that vary by provider
 */
export interface ChatSessionCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsSystemPrompts: boolean;
  supportsJsonSchema: boolean;
  supportsThinking: boolean;
  maxContextLength: number;
  supportedMimeTypes: string[];
}

/**
 * Session statistics and usage information
 */
export interface ChatSessionStats {
  messageCount: number;
  tokenCount: {
    input: number;
    output: number;
    total: number;
  };
  toolCallCount: number;
  errorCount: number;
  averageResponseTime: number;
  sessionDuration: number;
  provider: AIProvider;
  model: string;
}

/**
 * Events that can be emitted by chat sessions
 */
export enum ChatSessionEventType {
  MessageSent = 'message_sent',
  MessageReceived = 'message_received',
  ToolCallRequested = 'tool_call_requested',
  ToolCallCompleted = 'tool_call_completed',
  Error = 'error',
  StreamStarted = 'stream_started',
  StreamEnded = 'stream_ended',
  HistoryUpdated = 'history_updated',
  SessionReset = 'session_reset',
  ProviderSwitched = 'provider_switched',
}

/**
 * Event data structure for chat session events
 */
export interface ChatSessionEvent<T = any> {
  type: ChatSessionEventType;
  sessionId: string;
  provider: AIProvider;
  timestamp: number;
  data?: T;
}

/**
 * Error types specific to chat sessions
 */
export class ChatSessionError extends Error {
  constructor(
    message: string,
    public sessionId: string,
    public provider: AIProvider,
    public code?: string,
  ) {
    super(message);
    this.name = 'ChatSessionError';
  }
}

export class ChatSessionTimeoutError extends ChatSessionError {
  constructor(sessionId: string, provider: AIProvider) {
    super('Chat session request timed out', sessionId, provider, 'TIMEOUT');
    this.name = 'ChatSessionTimeoutError';
  }
}

export class ChatSessionRateLimitError extends ChatSessionError {
  constructor(
    sessionId: string,
    provider: AIProvider,
    public retryAfter?: number,
  ) {
    super('Rate limit exceeded for chat session', sessionId, provider, 'RATE_LIMIT');
    this.name = 'ChatSessionRateLimitError';
  }
}

/**
 * Factory interface for creating chat sessions
 */
export interface ChatSessionFactory {
  createSession(
    provider: AIProvider,
    model: string,
    config?: Partial<ChatGenerationConfig>,
  ): Promise<ChatSession>;

  getSupportedProviders(): AIProvider[];
  getAvailableModels(provider: AIProvider): Promise<string[]>;
}

/**
 * Options for session compression
 */
export interface CompressionOptions {
  tokenThreshold: number;
  preserveThreshold: number;
  force?: boolean;
}

/**
 * Result of session compression
 */
export interface CompressionResult {
  originalTokenCount: number;
  newTokenCount: number;
  compressionRatio: number;
  preservedMessageCount: number;
}

/**
 * Base implementation helpers for chat sessions
 */
export abstract class BaseChatSession implements ChatSession {
  public readonly sessionId: string;
  public readonly provider: AIProvider;
  public readonly model: string;

  protected history: Content[] = [];
  protected tools: Tool[] = [];
  protected stats: ChatSessionStats;
  protected startTime: number;

  constructor(sessionId: string, provider: AIProvider, model: string) {
    this.sessionId = sessionId;
    this.provider = provider;
    this.model = model;
    this.startTime = Date.now();
    this.stats = {
      messageCount: 0,
      tokenCount: { input: 0, output: 0, total: 0 },
      toolCallCount: 0,
      errorCount: 0,
      averageResponseTime: 0,
      sessionDuration: 0,
      provider,
      model,
    };
  }

  abstract sendMessage(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<GenerateContentResponse>;

  abstract sendMessageStream(
    params: ChatMessageParams,
    promptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  abstract generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model?: string,
    config?: ChatGenerationConfig,
  ): Promise<Record<string, unknown>>;

  abstract generateContent(
    contents: Content[],
    config: ChatGenerationConfig,
    abortSignal: AbortSignal,
    model?: string,
  ): Promise<GenerateContentResponse>;

  abstract generateEmbedding(texts: string[]): Promise<number[][]>;

  abstract countTokens(contents: Content[]): Promise<{ totalTokens: number }>;

  abstract getCapabilities(): ChatSessionCapabilities;

  abstract isHealthy(): Promise<boolean>;

  abstract reset(): Promise<void>;

  abstract dispose(): Promise<void>;

  // Common implementations

  getHistory(curated: boolean = false): Content[] {
    return structuredClone(this.history);
  }

  setHistory(history: Content[]): void {
    this.history = structuredClone(history);
  }

  clearHistory(): void {
    this.history = [];
  }

  addHistory(content: Content): void {
    this.history.push(content);
  }

  setTools(tools: Tool[]): void {
    this.tools = structuredClone(tools);
  }

  getFinalUsageMetadata(
    chunks: GenerateContentResponse[],
  ): GenerateContentResponseUsageMetadata | undefined {
    const lastChunk = chunks
      .slice()
      .reverse()
      .find((chunk) => chunk.usageMetadata);
    return lastChunk?.usageMetadata;
  }

  getStats(): ChatSessionStats {
    this.stats.sessionDuration = Date.now() - this.startTime;
    return { ...this.stats };
  }

  protected updateStats(
    inputTokens: number,
    outputTokens: number,
    responseTime: number,
  ): void {
    this.stats.messageCount++;
    this.stats.tokenCount.input += inputTokens;
    this.stats.tokenCount.output += outputTokens;
    this.stats.tokenCount.total += inputTokens + outputTokens;
    
    // Update average response time
    const totalResponseTime = this.stats.averageResponseTime * (this.stats.messageCount - 1) + responseTime;
    this.stats.averageResponseTime = totalResponseTime / this.stats.messageCount;
  }

  protected incrementToolCallCount(): void {
    this.stats.toolCallCount++;
  }

  protected incrementErrorCount(): void {
    this.stats.errorCount++;
  }
}