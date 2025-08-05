/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIProvider } from '@google/gemini-cli-core';
import {
  ChatStreamEvent,
  ChatStreamEventBus,
  ChatStreamEventHandler,
  ChatStreamEventType,
} from '../types/chatEvents.js';

/**
 * Implementation of the chat stream event bus
 */
export class ChatEventBus implements ChatStreamEventBus {
  private listeners = new Map<ChatStreamEventType, Set<ChatStreamEventHandler>>();
  private anyListeners = new Set<ChatStreamEventHandler>();
  private eventHistory: ChatStreamEvent[] = [];
  private currentProvider: AIProvider | null = null;
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  on<T extends ChatStreamEvent>(
    eventType: T['type'] | T['type'][],
    handler: ChatStreamEventHandler<T>,
  ): () => void {
    const types = Array.isArray(eventType) ? eventType : [eventType];
    
    for (const type of types) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type)!.add(handler as ChatStreamEventHandler);
    }

    // Return unsubscribe function
    return () => {
      for (const type of types) {
        this.listeners.get(type)?.delete(handler as ChatStreamEventHandler);
      }
    };
  }

  onAny(handler: ChatStreamEventHandler): () => void {
    this.anyListeners.add(handler);
    
    return () => {
      this.anyListeners.delete(handler);
    };
  }

  emit(event: ChatStreamEvent): void {
    // Update current provider
    this.currentProvider = event.provider;

    // Add to history
    this.addToHistory(event);

    // Emit to specific event type listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const handler of typeListeners) {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch(error => 
              console.warn(`Event handler error for ${event.type}:`, error)
            );
          }
        } catch (error) {
          console.warn(`Event handler error for ${event.type}:`, error);
        }
      }
    }

    // Emit to any listeners
    for (const handler of this.anyListeners) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch(error => 
            console.warn(`Any event handler error:`, error)
          );
        }
      } catch (error) {
        console.warn(`Any event handler error:`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
    this.anyListeners.clear();
    this.eventHistory = [];
  }

  getCurrentProvider(): AIProvider | null {
    return this.currentProvider;
  }

  getEventHistory(): ChatStreamEvent[] {
    return [...this.eventHistory];
  }

  private addToHistory(event: ChatStreamEvent): void {
    this.eventHistory.push(event);
    
    // Trim history if it exceeds max size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Create a filtered event stream for specific event types
   */
  createFilteredStream(
    eventTypes: ChatStreamEventType[],
  ): AsyncGenerator<ChatStreamEvent> {
    const eventQueue: ChatStreamEvent[] = [];
    let resolveNext: ((value: IteratorResult<ChatStreamEvent>) => void) | null = null;
    let isFinished = false;

    const unsubscribe = this.on(eventTypes, (event) => {
      if (isFinished) return;
      
      if (resolveNext) {
        resolveNext({ value: event, done: false });
        resolveNext = null;
      } else {
        eventQueue.push(event);
      }
    });

    return {
      async next(): Promise<IteratorResult<ChatStreamEvent>> {
        if (isFinished) {
          return { value: undefined, done: true };
        }

        if (eventQueue.length > 0) {
          return { value: eventQueue.shift()!, done: false };
        }

        return new Promise((resolve) => {
          resolveNext = resolve;
        });
      },

      async return(): Promise<IteratorResult<ChatStreamEvent>> {
        isFinished = true;
        unsubscribe();
        return { value: undefined, done: true };
      },

      async throw(e?: any): Promise<IteratorResult<ChatStreamEvent>> {
        isFinished = true;
        unsubscribe();
        throw e;
      },

      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /**
   * Wait for a specific event type
   */
  waitFor<T extends ChatStreamEvent>(
    eventType: T['type'],
    timeout?: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;
      
      const unsubscribe = this.on(eventType, (event) => {
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();
        resolve(event as T);
      });

      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${eventType}`));
        }, timeout);
      }
    });
  }

  /**
   * Get statistics about event processing
   */
  getStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    currentProvider: AIProvider | null;
    activeListeners: number;
  } {
    const eventsByType: Record<string, number> = {};
    
    for (const event of this.eventHistory) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    return {
      totalEvents: this.eventHistory.length,
      eventsByType,
      currentProvider: this.currentProvider,
      activeListeners: this.anyListeners.size + 
        Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0),
    };
  }
}

/**
 * Create a new event bus instance
 */
export function createChatEventBus(maxHistorySize?: number): ChatStreamEventBus {
  return new ChatEventBus(maxHistorySize);
}

/**
 * Utility functions for event conversion
 */
export const EventConverters = {
  /**
   * Convert Gemini events to generic chat events
   */
  fromGeminiEvent(
    geminiEvent: any,
    provider: AIProvider,
    sessionId?: string,
  ): ChatStreamEvent | null {
    const timestamp = Date.now();
    
    switch (geminiEvent.type) {
      case 'content':
        return {
          type: ChatStreamEventType.CONTENT,
          provider,
          timestamp,
          sessionId,
          data: geminiEvent.value,
        };

      case 'thought':
        return {
          type: ChatStreamEventType.THOUGHT,
          provider,
          timestamp,
          sessionId,
          data: geminiEvent.value,
        };

      case 'tool_call_request':
        return {
          type: ChatStreamEventType.TOOL_CALL,
          provider,
          timestamp,
          sessionId,
          data: {
            callId: geminiEvent.value.callId,
            name: geminiEvent.value.name,
            args: geminiEvent.value.args,
            isClientInitiated: geminiEvent.value.isClientInitiated,
          },
        };

      case 'user_cancelled':
        return {
          type: ChatStreamEventType.CANCELLED,
          provider,
          timestamp,
          sessionId,
          data: { reason: 'user' },
        };

      case 'error':
        return {
          type: ChatStreamEventType.ERROR,
          provider,
          timestamp,
          sessionId,
          data: {
            message: geminiEvent.value.error.message,
            statusCode: geminiEvent.value.error.status,
          },
        };

      case 'chat_compressed':
        return {
          type: ChatStreamEventType.CONTEXT_COMPRESSED,
          provider,
          timestamp,
          sessionId,
          data: {
            originalTokenCount: geminiEvent.value?.originalTokenCount || 0,
            newTokenCount: geminiEvent.value?.newTokenCount || 0,
            compressionRatio: geminiEvent.value 
              ? (geminiEvent.value.newTokenCount / geminiEvent.value.originalTokenCount)
              : 0,
          },
        };

      case 'finished':
        return {
          type: ChatStreamEventType.END,
          provider,
          timestamp,
          sessionId,
          data: {
            reason: geminiEvent.value,
          },
        };

      case 'max_session_turns':
        return {
          type: ChatStreamEventType.SESSION_LIMIT,
          provider,
          timestamp,
          sessionId,
          data: {
            currentTurns: 0, // Would need to be provided
            maxTurns: 0,     // Would need to be provided
          },
        };

      case 'loop_detected':
        return {
          type: ChatStreamEventType.LOOP_DETECTED,
          provider,
          timestamp,
          sessionId,
          data: {
            pattern: 'unknown',
            occurrences: 1,
          },
        };

      default:
        return null;
    }
  },

  /**
   * Convert Claude events to generic chat events
   */
  fromClaudeEvent(
    claudeEvent: any,
    provider: AIProvider,
    sessionId?: string,
  ): ChatStreamEvent | null {
    const timestamp = Date.now();

    // Claude-specific event conversion logic would go here
    // This is a placeholder for future implementation
    return null;
  },

  /**
   * Convert Ollama events to generic chat events
   */
  fromOllamaEvent(
    ollamaEvent: any,
    provider: AIProvider,
    sessionId?: string,
  ): ChatStreamEvent | null {
    const timestamp = Date.now();

    // Ollama-specific event conversion logic would go here
    // This is a placeholder for future implementation
    return null;
  },
};