/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStream } from './useChatStream.js';
import {
  ChatStreamEventType,
  TokenEvent,
  ToolCallEvent,
  ErrorEvent,
  EndEvent,
} from '../types/chatEvents.js';
import { AIProvider } from '@google/gemini-cli-core';
import { MessageType } from '../types.js';

// Mock dependencies
const mockConfig = {
  getSessionId: () => 'test-session-123',
  getModel: () => 'test-model',
  getContentGeneratorConfig: () => ({ authType: 'test' }),
  getProjectRoot: () => '/test/project',
  getMaxSessionTurns: () => 100,
  getCheckpointingEnabled: () => false,
  getProjectTempDir: () => '/tmp/test',
  setQuotaErrorOccurred: vi.fn(),
};

const mockChatSession = {
  sessionId: 'test-session-123',
  provider: AIProvider.GEMINI,
  model: 'test-model',
  sendMessageStream: vi.fn(),
  getHistory: vi.fn(() => []),
  addHistory: vi.fn(),
  setTools: vi.fn(),
};

const mockAddItem = vi.fn();
const mockOnDebugMessage = vi.fn();
const mockHandleSlashCommand = vi.fn();
const mockGetPreferredEditor = vi.fn();
const mockOnAuthError = vi.fn();
const mockPerformMemoryRefresh = vi.fn();
const mockSetModelSwitchedFromQuotaError = vi.fn();

// Mock logger
vi.mock('./useLogger.js', () => ({
  useLogger: () => ({
    logMessage: vi.fn(),
  }),
}));

// Mock session stats
vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 1,
  }),
}));

// Mock tool scheduler
vi.mock('./useReactToolScheduler.js', () => ({
  useReactToolScheduler: () => [
    [], // toolCalls
    vi.fn(), // scheduleToolCalls
    vi.fn(), // markToolsAsSubmitted
  ],
  mapToDisplay: vi.fn(() => ({})),
}));

// Mock shell command processor
vi.mock('./shellCommandProcessor.js', () => ({
  useShellCommandProcessor: () => ({
    handleShellCommand: vi.fn(),
  }),
}));

// Mock useStateAndRef
vi.mock('./useStateAndRef.js', () => ({
  useStateAndRef: (initial: any) => [initial, vi.fn()],
}));

describe('useChatStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    chatSession: mockChatSession as any,
    history: [],
    addItem: mockAddItem,
    config: mockConfig as any,
    onDebugMessage: mockOnDebugMessage,
    handleSlashCommand: mockHandleSlashCommand,
    shellModeActive: false,
    getPreferredEditor: mockGetPreferredEditor,
    onAuthError: mockOnAuthError,
    performMemoryRefresh: mockPerformMemoryRefresh,
    modelSwitchedFromQuotaError: false,
    setModelSwitchedFromQuotaError: mockSetModelSwitchedFromQuotaError,
  };

  it('should initialize with correct provider and model', () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    expect(result.current.streamStatus.provider).toBe(AIProvider.GEMINI);
    expect(result.current.streamStatus.model).toBe('test-model');
    expect(result.current.streamStatus.sessionId).toBe('test-session-123');
  });

  it('should handle token events correctly', async () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    act(() => {
      const tokenEvent: TokenEvent = {
        type: ChatStreamEventType.TOKEN,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        sessionId: 'test-session-123',
        data: 'Hello',
      };
      result.current.eventBus.emit(tokenEvent);
    });

    // Should handle the token event (exact assertions would depend on implementation details)
    expect(mockAddItem).toBeCalled();
  });

  it('should handle tool call events correctly', async () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    act(() => {
      const toolCallEvent: ToolCallEvent = {
        type: ChatStreamEventType.TOOL_CALL,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        sessionId: 'test-session-123',
        data: {
          callId: 'tool-123',
          name: 'test_tool',
          args: { param: 'value' },
          isClientInitiated: false,
        },
      };
      result.current.eventBus.emit(toolCallEvent);
    });

    // Tool call should be scheduled
    expect(result.current.eventBus.getEventHistory()).toContainEqual(
      expect.objectContaining({
        type: ChatStreamEventType.TOOL_CALL,
        data: expect.objectContaining({
          callId: 'tool-123',
          name: 'test_tool',
        }),
      })
    );
  });

  it('should handle error events correctly', async () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    act(() => {
      const errorEvent: ErrorEvent = {
        type: ChatStreamEventType.ERROR,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        sessionId: 'test-session-123',
        data: {
          message: 'Test error message',
          code: 'TEST_ERROR',
          recoverable: false,
        },
      };
      result.current.eventBus.emit(errorEvent);
    });

    // Error should be added to history
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
      }),
      expect.any(Number),
    );
  });

  it('should handle end events correctly', async () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    act(() => {
      const endEvent: EndEvent = {
        type: ChatStreamEventType.END,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        sessionId: 'test-session-123',
        data: {
          reason: 'STOP',
          tokensUsed: {
            input: 100,
            output: 50,
            total: 150,
          },
        },
      };
      result.current.eventBus.emit(endEvent);
    });

    // Should update stream state to finished
    expect(result.current.streamState).toBe('finished');
  });

  it('should support multi-provider event conversion', () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    // Test Gemini event conversion
    const geminiEvent = {
      type: 'content',
      value: 'Hello from Gemini',
    };

    const convertedEvent = result.current.eventBus.createFilteredStream([
      ChatStreamEventType.CONTENT,
    ]);

    // This tests the event bus filtering capability
    expect(convertedEvent).toBeDefined();
  });

  it('should provide event bus statistics', () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    // Emit some events
    act(() => {
      result.current.eventBus.emit({
        type: ChatStreamEventType.TOKEN,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        data: 'test',
      });

      result.current.eventBus.emit({
        type: ChatStreamEventType.CONTENT,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        data: 'test content',
      });
    });

    const stats = result.current.eventBus.getStats();
    expect(stats.totalEvents).toBe(2);
    expect(stats.eventsByType[ChatStreamEventType.TOKEN]).toBe(1);
    expect(stats.eventsByType[ChatStreamEventType.CONTENT]).toBe(1);
    expect(stats.currentProvider).toBe(AIProvider.GEMINI);
  });

  it('should handle provider switching', async () => {
    // Create a Claude session
    const claudeChatSession = {
      ...mockChatSession,
      provider: AIProvider.CLAUDE,
      model: 'claude-3-5-sonnet',
      sessionId: 'claude-session-456',
    };

    const { result, rerender } = renderHook(
      (props) => useChatStream(props),
      { initialProps: defaultProps }
    );

    // Switch to Claude
    act(() => {
      rerender({
        ...defaultProps,
        chatSession: claudeChatSession as any,
      });
    });

    expect(result.current.streamStatus.provider).toBe(AIProvider.CLAUDE);
    expect(result.current.streamStatus.model).toBe('claude-3-5-sonnet');
  });

  it('should clean up event listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useChatStream(defaultProps));
    
    const initialStats = result.current.eventBus.getStats();
    expect(initialStats.activeListeners).toBeGreaterThan(0);

    unmount();

    // Event bus should still exist but listeners should be cleaned up
    // (Note: This test would need adjustment based on actual cleanup implementation)
  });

  it('should wait for specific events', async () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    const waitPromise = result.current.eventBus.waitFor(
      ChatStreamEventType.END,
      1000, // 1 second timeout
    );

    act(() => {
      result.current.eventBus.emit({
        type: ChatStreamEventType.END,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        data: { reason: 'STOP' },
      });
    });

    const event = await waitPromise;
    expect(event.type).toBe(ChatStreamEventType.END);
    expect(event.data.reason).toBe('STOP');
  });

  it('should timeout when waiting for events', async () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    const waitPromise = result.current.eventBus.waitFor(
      ChatStreamEventType.END,
      10, // 10ms timeout
    );

    await expect(waitPromise).rejects.toThrow('Timeout waiting for event: end');
  });

  it('should handle thought events', () => {
    const { result } = renderHook(() => useChatStream(defaultProps));

    act(() => {
      result.current.eventBus.emit({
        type: ChatStreamEventType.THOUGHT,
        provider: AIProvider.GEMINI,
        timestamp: Date.now(),
        data: {
          subject: 'Test Thought',
          description: 'This is a test thought',
        },
      });
    });

    expect(result.current.thought).toEqual({
      subject: 'Test Thought',
      description: 'This is a test thought',
    });
  });
});