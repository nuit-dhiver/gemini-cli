/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponse, Content, Tool, Part } from '@google/genai';

/**
 * Supported AI providers
 */
export enum AIProvider {
  GEMINI = 'gemini',
  CLAUDE = 'claude',
  OLLAMA = 'ollama',
}

/**
 * Authentication types for different providers
 */
export enum ProviderAuthType {
  // Gemini auth types
  OAUTH_PERSONAL = 'oauth-personal',
  GEMINI_API_KEY = 'gemini-api-key',
  VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  
  // Claude auth types
  CLAUDE_API_KEY = 'claude-api-key',
  
  // Ollama auth types
  OLLAMA_LOCAL = 'ollama-local',
  OLLAMA_REMOTE = 'ollama-remote',
}

/**
 * Configuration for individual providers
 */
export interface ProviderConfig {
  provider: AIProvider;
  model: string;
  authType: ProviderAuthType;
  apiKey?: string;
  endpoint?: string; // For custom endpoints (Ollama, Claude)
  proxy?: string;
  enabled: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  vertexai?: boolean; // For Gemini Vertex AI
}

/**
 * Unified response interface that all providers must conform to
 */
export interface UnifiedResponse {
  id: string;
  provider: AIProvider;
  model: string;
  content: Content[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  finishReason?: string;
  error?: string;
}

/**
 * Unified request parameters for all providers
 */
export interface UnifiedRequest {
  model: string;
  contents: Content[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

/**
 * Provider-specific capabilities
 */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsSystemPrompts: boolean;
  maxContextLength: number;
  supportedModels: string[];
}

/**
 * Base interface that all provider clients must implement
 */
export interface ProviderClient {
  readonly provider: AIProvider;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  /**
   * Generate content using the provider's API
   */
  generateContent(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<UnifiedResponse>;

  /**
   * Generate streaming content using the provider's API
   */
  generateContentStream(
    request: UnifiedRequest,
    promptId: string,
  ): Promise<AsyncGenerator<UnifiedResponse>>;

  /**
   * Count tokens for the given content
   */
  countTokens(contents: Content[]): Promise<{ totalTokens: number }>;

  /**
   * Validate the provider configuration
   */
  validateConfig(): Promise<boolean>;

  /**
   * Get available models for this provider
   */
  getAvailableModels(): Promise<string[]>;

  /**
   * Test connection to the provider
   */
  testConnection(): Promise<boolean>;
}

/**
 * Provider session that maintains conversation history
 */
export interface ProviderSession {
  readonly sessionId: string;
  readonly provider: AIProvider;
  readonly client: ProviderClient;
  
  history: Content[];
  
  /**
   * Send message and get response
   */
  sendMessage(
    message: string | Part[],
    config?: Partial<UnifiedRequest>,
  ): Promise<UnifiedResponse>;

  /**
   * Send message and get streaming response
   */
  sendMessageStream(
    message: string | Part[],
    config?: Partial<UnifiedRequest>,
  ): Promise<AsyncGenerator<UnifiedResponse>>;

  /**
   * Clear conversation history
   */
  clearHistory(): void;

  /**
   * Get conversation history
   */
  getHistory(): Content[];

  /**
   * Set conversation history
   */
  setHistory(history: Content[]): void;

  /**
   * Set tools for this session
   */
  setTools(tools: Tool[]): void;
}

/**
 * Agent configuration combining provider and session settings
 */
export interface AgentConfig {
  agentId: string;
  name: string;
  provider: AIProvider;
  providerConfig: ProviderConfig;
  tools?: Tool[];
  systemPrompt?: string;
  autoStart?: boolean;
  maxSessions?: number;
}

/**
 * Multi-agent manager interface
 */
export interface AgentManager {
  /**
   * Create a new agent with the given configuration
   */
  createAgent(config: AgentConfig): Promise<string>;

  /**
   * Get an existing agent by ID
   */
  getAgent(agentId: string): Promise<ProviderSession | null>;

  /**
   * List all active agents
   */
  listAgents(): Promise<AgentConfig[]>;

  /**
   * Remove an agent
   */
  removeAgent(agentId: string): Promise<void>;

  /**
   * Start a session with an agent
   */
  startSession(agentId: string): Promise<string>;

  /**
   * End a session
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * Get all active sessions
   */
  getActiveSessions(): Promise<ProviderSession[]>;

  /**
   * Switch between agents/sessions
   */
  switchToSession(sessionId: string): Promise<void>;
}

/**
 * Error types for provider operations
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: AIProvider,
    public code?: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message: string, provider: AIProvider) {
    super(message, provider, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string, provider: AIProvider, retryAfter?: number) {
    super(message, provider, 'RATE_LIMIT_ERROR', 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
  
  public retryAfter?: number;
}

export class ModelNotFoundError extends ProviderError {
  constructor(message: string, provider: AIProvider, model: string) {
    super(message, provider, 'MODEL_NOT_FOUND', 404);
    this.name = 'ModelNotFoundError';
    this.model = model;
  }
  
  public model: string;
}