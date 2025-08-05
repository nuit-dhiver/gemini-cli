/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiProviderChat } from '../integration/MultiProviderChat.js';
import { GeminiChat } from '../../core/geminiChat.js';
import { Config } from '../../config/config.js';
import {
  AIProvider,
  AgentManager,
  ProviderSession,
  UnifiedResponse,
} from '../types.js';

// Mock dependencies
vi.mock('../../core/geminiChat.js');

describe('MultiProviderChat', () => {
  let multiProviderChat: MultiProviderChat;
  let mockConfig: Config;
  let mockAgentManager: AgentManager;
  let mockGeminiChat: GeminiChat;
  let mockProviderSession: ProviderSession;

  beforeEach(() => {
    // Mock Config
    mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-2.0-flash-exp'),
      getProxy: vi.fn().mockReturnValue(undefined),
    } as any;

    // Mock ProviderSession
    mockProviderSession = {
      sessionId: 'test-session-123',
      provider: AIProvider.GEMINI,
      client: {
        provider: AIProvider.GEMINI,
        config: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: 'gemini-api-key',
          enabled: true,
        },
      },
      history: [],
      sendMessage: vi.fn().mockResolvedValue({
        id: 'response-1',
        provider: AIProvider.GEMINI,
        model: 'gemini-2.0-flash-exp',
        content: [
          {
            role: 'model',
            parts: [{ text: 'Hello! How can I help you?' }],
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 15,
          totalTokenCount: 25,
        },
      } as UnifiedResponse),
      sendMessageStream: vi.fn(),
      clearHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      setHistory: vi.fn(),
      setTools: vi.fn(),
    } as any;

    // Mock AgentManager
    mockAgentManager = {
      listAgents: vi.fn().mockResolvedValue([]),
      getActiveSessions: vi.fn().mockResolvedValue([mockProviderSession]),
      switchToSession: vi.fn().mockResolvedValue(undefined),
      createQuickSession: vi.fn().mockResolvedValue('quick-session-456'),
      getStats: vi.fn().mockReturnValue({
        totalAgents: 1,
        activeAgents: 1,
        totalSessions: 1,
        sessionsByProvider: {
          [AIProvider.GEMINI]: 1,
          [AIProvider.CLAUDE]: 0,
          [AIProvider.OLLAMA]: 0,
        },
      }),
    } as any;

    // Mock GeminiChat
    mockGeminiChat = {
      sendMessage: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Gemini fallback response' }],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 12,
          totalTokenCount: 20,
        },
      }),
      sendMessageStream: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      addHistory: vi.fn(),
      setHistory: vi.fn(),
      setTools: vi.fn(),
      getFinalUsageMetadata: vi.fn(),
    } as any;

    multiProviderChat = new MultiProviderChat(
      mockConfig,
      mockAgentManager,
      mockGeminiChat
    );
  });

  describe('initialization', () => {
    it('should initialize without active session', () => {
      expect(multiProviderChat.getActiveSession()).toBeNull();
      expect(multiProviderChat.isMultiProviderMode()).toBe(false);
    });

    it('should get provider info when no active session', () => {
      const info = multiProviderChat.getActiveProviderInfo();
      
      expect(info.provider).toBeNull();
      expect(info.model).toBeNull();
      expect(info.sessionId).toBeNull();
    });
  });

  describe('session management', () => {
    it('should set and get active session', () => {
      multiProviderChat.setActiveSession(mockProviderSession);
      
      expect(multiProviderChat.getActiveSession()).toBe(mockProviderSession);
      expect(multiProviderChat.isMultiProviderMode()).toBe(true);
    });

    it('should get provider info with active session', () => {
      multiProviderChat.setActiveSession(mockProviderSession);
      
      const info = multiProviderChat.getActiveProviderInfo();
      
      expect(info.provider).toBe(AIProvider.GEMINI);
      expect(info.model).toBe('gemini-2.0-flash-exp');
      expect(info.sessionId).toBe('test-session-123');
    });

    it('should switch to provider session', async () => {
      await multiProviderChat.switchToProvider('test-session-123');
      
      expect(mockAgentManager.switchToSession).toHaveBeenCalledWith('test-session-123');
      expect(mockAgentManager.getActiveSessions).toHaveBeenCalled();
    });
  });

  describe('message handling with provider session', () => {
    beforeEach(() => {
      multiProviderChat.setActiveSession(mockProviderSession);
    });

    it('should send message via provider session', async () => {
      const response = await multiProviderChat.sendMessage(
        { message: 'Hello, world!' },
        'test-prompt-1'
      );

      expect(mockProviderSession.sendMessage).toHaveBeenCalledWith(
        'Hello, world!',
        expect.any(Object)
      );

      expect(response.candidates).toHaveLength(1);
      expect(response.candidates[0].content.parts[0].text).toBe('Hello! How can I help you?');
      expect(response.usageMetadata?.totalTokenCount).toBe(25);
    });

    it('should send streaming message via provider session', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            id: 'stream-1',
            provider: AIProvider.GEMINI,
            model: 'gemini-2.0-flash-exp',
            content: [
              {
                role: 'model',
                parts: [{ text: 'Streaming' }],
              },
            ],
          } as UnifiedResponse;
          
          yield {
            id: 'stream-2',
            provider: AIProvider.GEMINI,
            model: 'gemini-2.0-flash-exp',
            content: [
              {
                role: 'model',
                parts: [{ text: ' response' }],
              },
            ],
          } as UnifiedResponse;
        },
      };

      mockProviderSession.sendMessageStream = vi.fn().mockResolvedValue(mockStreamResponse);

      const streamGen = await multiProviderChat.sendMessageStream(
        { message: 'Stream test' },
        'test-prompt-stream'
      );

      const responses = [];
      for await (const response of streamGen) {
        responses.push(response);
      }

      expect(responses).toHaveLength(2);
      expect(responses[0].candidates[0].content.parts[0].text).toBe('Streaming');
      expect(responses[1].candidates[0].content.parts[0].text).toBe(' response');
    });

    it('should handle Content message type', async () => {
      const contentMessage = {
        role: 'user' as const,
        parts: [{ text: 'Content message test' }],
      };

      await multiProviderChat.sendMessage(
        { message: contentMessage },
        'test-prompt-content'
      );

      expect(mockProviderSession.sendMessage).toHaveBeenCalledWith(
        [{ text: 'Content message test' }],
        expect.any(Object)
      );
    });
  });

  describe('fallback to Gemini chat', () => {
    it('should use Gemini chat when no active session', async () => {
      const response = await multiProviderChat.sendMessage(
        { message: 'Fallback test' },
        'test-prompt-fallback'
      );

      expect(mockGeminiChat.sendMessage).toHaveBeenCalledWith(
        { message: 'Fallback test' },
        'test-prompt-fallback'
      );

      expect(response.candidates[0].content.parts[0].text).toBe('Gemini fallback response');
    });

    it('should throw error when no session and no fallback', async () => {
      const chatWithoutFallback = new MultiProviderChat(mockConfig, mockAgentManager);

      await expect(
        chatWithoutFallback.sendMessage({ message: 'Test' }, 'test-prompt')
      ).rejects.toThrow('No active provider session or fallback available');
    });
  });

  describe('history management', () => {
    beforeEach(() => {
      multiProviderChat.setActiveSession(mockProviderSession);
    });

    it('should get history from active session', () => {
      const mockHistory = [
        { role: 'user' as const, parts: [{ text: 'Hello' }] },
        { role: 'model' as const, parts: [{ text: 'Hi there!' }] },
      ];

      mockProviderSession.getHistory = vi.fn().mockReturnValue(mockHistory);

      const history = multiProviderChat.getHistory();
      expect(history).toEqual(mockHistory);
    });

    it('should clear history in active session', () => {
      multiProviderChat.clearHistory();
      expect(mockProviderSession.clearHistory).toHaveBeenCalled();
    });

    it('should set history in active session', () => {
      const newHistory = [
        { role: 'user' as const, parts: [{ text: 'New conversation' }] },
      ];

      multiProviderChat.setHistory(newHistory);
      expect(mockProviderSession.setHistory).toHaveBeenCalledWith(newHistory);
    });

    it('should add history to active session', () => {
      mockProviderSession.getHistory = vi.fn().mockReturnValue([
        { role: 'user' as const, parts: [{ text: 'Existing' }] },
      ]);

      const newContent = { role: 'model' as const, parts: [{ text: 'New' }] };
      multiProviderChat.addHistory(newContent);

      expect(mockProviderSession.setHistory).toHaveBeenCalledWith([
        { role: 'user' as const, parts: [{ text: 'Existing' }] },
        newContent,
      ]);
    });
  });

  describe('tools management', () => {
    beforeEach(() => {
      multiProviderChat.setActiveSession(mockProviderSession);
    });

    it('should set tools for active session', () => {
      const tools = [
        {
          function_declarations: [{
            name: 'test_tool',
            description: 'Test tool',
            parameters: { type: 'object', properties: {} },
          }],
        },
      ];

      multiProviderChat.setTools(tools);
      expect(mockProviderSession.setTools).toHaveBeenCalledWith(tools);
    });

    it('should apply tools to new session when set', () => {
      const tools = [
        {
          function_declarations: [{
            name: 'test_tool',
            description: 'Test tool',
            parameters: { type: 'object', properties: {} },
          }],
        },
      ];

      multiProviderChat.setTools(tools);
      multiProviderChat.setActiveSession(mockProviderSession);

      expect(mockProviderSession.setTools).toHaveBeenCalledWith(tools);
    });
  });

  describe('quick session creation', () => {
    it('should create quick session and switch to it', async () => {
      const sessionId = await multiProviderChat.createQuickSession(
        AIProvider.CLAUDE,
        'claude-3-5-sonnet-20241022',
        'Quick Claude'
      );

      expect(mockAgentManager.createQuickSession).toHaveBeenCalledWith(
        AIProvider.CLAUDE,
        'claude-3-5-sonnet-20241022',
        'Quick Claude'
      );

      expect(sessionId).toBe('quick-session-456');
    });
  });

  describe('statistics', () => {
    it('should get stats from agent manager', () => {
      const stats = multiProviderChat.getStats();

      expect(mockAgentManager.getStats).toHaveBeenCalled();
      expect(stats.totalAgents).toBe(1);
      expect(stats.totalSessions).toBe(1);
    });
  });

  describe('usage metadata handling', () => {
    it('should get final usage metadata from Gemini chat', () => {
      const chunks = [
        { usageMetadata: { totalTokenCount: 10 } },
        { usageMetadata: { totalTokenCount: 20 } },
      ] as any[];

      mockGeminiChat.getFinalUsageMetadata = vi.fn().mockReturnValue(
        chunks[1].usageMetadata
      );

      const metadata = multiProviderChat.getFinalUsageMetadata(chunks);
      
      expect(mockGeminiChat.getFinalUsageMetadata).toHaveBeenCalledWith(chunks);
      expect(metadata.totalTokenCount).toBe(20);
    });

    it('should extract usage metadata from chunks when no Gemini chat', () => {
      const chatWithoutFallback = new MultiProviderChat(mockConfig, mockAgentManager);
      
      const chunks = [
        { usageMetadata: undefined },
        { usageMetadata: { totalTokenCount: 30 } },
      ] as any[];

      const metadata = chatWithoutFallback.getFinalUsageMetadata(chunks);
      expect(metadata.totalTokenCount).toBe(30);
    });
  });
});