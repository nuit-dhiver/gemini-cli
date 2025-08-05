/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIProvider } from '@google/gemini-cli-core';
import { FinishReason } from '@google/genai';

/**
 * Provider-agnostic chat event types
 * These replace the Gemini-specific event types with generic equivalents
 */
export enum ChatStreamEventType {
  // Content streaming
  TOKEN = 'token',           // Individual token/content chunk
  CONTENT = 'content',       // Larger content block
  THOUGHT = 'thought',       // AI reasoning/thinking content
  
  // Tool interactions
  TOOL_CALL = 'tool_call',   // Tool execution request
  TOOL_RESULT = 'tool_result', // Tool execution result
  TOOL_CONFIRMATION = 'tool_confirmation', // Tool execution confirmation needed
  
  // Session management
  START = 'start',           // Stream/session started
  END = 'end',               // Stream/session ended
  PAUSE = 'pause',           // Stream paused (waiting for input)
  RESUME = 'resume',         // Stream resumed
  
  // Status and errors
  ERROR = 'error',           // Error occurred
  CANCELLED = 'cancelled',   // User cancelled
  TIMEOUT = 'timeout',       // Request timed out
  
  // Context management
  CONTEXT_COMPRESSED = 'context_compressed', // Context was compressed
  CONTEXT_LIMIT = 'context_limit',           // Context limit reached
  SESSION_LIMIT = 'session_limit',           // Session turn limit reached
  
  // Special states
  LOOP_DETECTED = 'loop_detected',           // Infinite loop detected
  PROVIDER_SWITCHED = 'provider_switched',   // AI provider changed
}

/**
 * Base interface for all chat stream events
 */
export interface BaseChatStreamEvent<T = any> {
  type: ChatStreamEventType;
  provider: AIProvider;
  timestamp: number;
  sessionId?: string;
  data?: T;
}

/**
 * Token/content streaming events
 */
export interface TokenEvent extends BaseChatStreamEvent<string> {
  type: ChatStreamEventType.TOKEN;
  data: string; // Individual token or small content chunk
}

export interface ContentEvent extends BaseChatStreamEvent<string> {
  type: ChatStreamEventType.CONTENT;
  data: string; // Larger content block
}

export interface ThoughtEvent extends BaseChatStreamEvent<{
  subject: string;
  description: string;
}> {
  type: ChatStreamEventType.THOUGHT;
}

/**
 * Tool interaction events
 */
export interface ToolCallEvent extends BaseChatStreamEvent<{
  callId: string;
  name: string;
  args: Record<string, unknown>;
  isClientInitiated: boolean;
}> {
  type: ChatStreamEventType.TOOL_CALL;
}

export interface ToolResultEvent extends BaseChatStreamEvent<{
  callId: string;
  result: any;
  error?: string;
  status: 'success' | 'error' | 'cancelled';
}> {
  type: ChatStreamEventType.TOOL_RESULT;
}

export interface ToolConfirmationEvent extends BaseChatStreamEvent<{
  callId: string;
  name: string;
  args: Record<string, unknown>;
  confirmationMessage: string;
}> {
  type: ChatStreamEventType.TOOL_CONFIRMATION;
}

/**
 * Session management events
 */
export interface StartEvent extends BaseChatStreamEvent<{
  model: string;
  provider: AIProvider;
}> {
  type: ChatStreamEventType.START;
}

export interface EndEvent extends BaseChatStreamEvent<{
  reason: FinishReason | string;
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
}> {
  type: ChatStreamEventType.END;
}

export interface PauseEvent extends BaseChatStreamEvent<{
  reason: 'tool_confirmation' | 'user_input' | 'rate_limit';
}> {
  type: ChatStreamEventType.PAUSE;
}

export interface ResumeEvent extends BaseChatStreamEvent {
  type: ChatStreamEventType.RESUME;
}

/**
 * Error and status events
 */
export interface ErrorEvent extends BaseChatStreamEvent<{
  message: string;
  code?: string;
  statusCode?: number;
  recoverable?: boolean;
}> {
  type: ChatStreamEventType.ERROR;
}

export interface CancelledEvent extends BaseChatStreamEvent<{
  reason: 'user' | 'timeout' | 'system';
}> {
  type: ChatStreamEventType.CANCELLED;
}

export interface TimeoutEvent extends BaseChatStreamEvent<{
  timeoutMs: number;
}> {
  type: ChatStreamEventType.TIMEOUT;
}

/**
 * Context management events
 */
export interface ContextCompressedEvent extends BaseChatStreamEvent<{
  originalTokenCount: number;
  newTokenCount: number;
  compressionRatio: number;
}> {
  type: ChatStreamEventType.CONTEXT_COMPRESSED;
}

export interface ContextLimitEvent extends BaseChatStreamEvent<{
  currentTokens: number;
  maxTokens: number;
}> {
  type: ChatStreamEventType.CONTEXT_LIMIT;
}

export interface SessionLimitEvent extends BaseChatStreamEvent<{
  currentTurns: number;
  maxTurns: number;
}> {
  type: ChatStreamEventType.SESSION_LIMIT;
}

/**
 * Special state events
 */
export interface LoopDetectedEvent extends BaseChatStreamEvent<{
  pattern: string;
  occurrences: number;
}> {
  type: ChatStreamEventType.LOOP_DETECTED;
}

export interface ProviderSwitchedEvent extends BaseChatStreamEvent<{
  fromProvider: AIProvider;
  toProvider: AIProvider;
  reason: string;
}> {
  type: ChatStreamEventType.PROVIDER_SWITCHED;
}

/**
 * Union type of all possible chat stream events
 */
export type ChatStreamEvent =
  | TokenEvent
  | ContentEvent
  | ThoughtEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolConfirmationEvent
  | StartEvent
  | EndEvent
  | PauseEvent
  | ResumeEvent
  | ErrorEvent
  | CancelledEvent
  | TimeoutEvent
  | ContextCompressedEvent
  | ContextLimitEvent
  | SessionLimitEvent
  | LoopDetectedEvent
  | ProviderSwitchedEvent;

/**
 * Event handler function type
 */
export type ChatStreamEventHandler<T = ChatStreamEvent> = (event: T) => void | Promise<void>;

/**
 * Event bus interface for chat streams
 */
export interface ChatStreamEventBus {
  /**
   * Subscribe to specific event types
   */
  on<T extends ChatStreamEvent>(
    eventType: T['type'] | T['type'][],
    handler: ChatStreamEventHandler<T>,
  ): () => void; // Returns unsubscribe function

  /**
   * Subscribe to all events
   */
  onAny(handler: ChatStreamEventHandler): () => void;

  /**
   * Emit an event
   */
  emit(event: ChatStreamEvent): void;

  /**
   * Remove all listeners
   */
  clear(): void;

  /**
   * Get current provider
   */
  getCurrentProvider(): AIProvider | null;

  /**
   * Get event history (for debugging)
   */
  getEventHistory(): ChatStreamEvent[];
}

/**
 * Configuration for chat stream processing
 */
export interface ChatStreamConfig {
  provider: AIProvider;
  model: string;
  sessionId?: string;
  bufferEvents?: boolean;           // Buffer events for batching
  bufferTimeoutMs?: number;         // Timeout for event buffering
  enableThoughts?: boolean;         // Enable thought processing
  enableToolCalls?: boolean;        // Enable tool call processing
  maxEventHistory?: number;         // Max events to keep in history
}

/**
 * Chat stream state
 */
export enum ChatStreamState {
  IDLE = 'idle',
  STREAMING = 'streaming',
  WAITING_FOR_TOOLS = 'waiting_for_tools',
  WAITING_FOR_CONFIRMATION = 'waiting_for_confirmation',
  ERROR = 'error',
  CANCELLED = 'cancelled',
  FINISHED = 'finished',
}

/**
 * Chat stream status information
 */
export interface ChatStreamStatus {
  state: ChatStreamState;
  provider: AIProvider;
  model: string;
  sessionId?: string;
  currentThought?: {
    subject: string;
    description: string;
  };
  pendingToolCalls?: Array<{
    callId: string;
    name: string;
    status: 'pending' | 'executing' | 'awaiting_confirmation';
  }>;
  tokensProcessed?: {
    input: number;
    output: number;
    total: number;
  };
  lastError?: {
    message: string;
    code?: string;
    recoverable?: boolean;
  };
}