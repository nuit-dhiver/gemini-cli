/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MultiAgentManager } from '../manager/AgentManager.js';
import { ProviderFactory } from '../manager/ProviderFactory.js';
import { AIProvider, ProviderAuthType, AgentConfig } from '../types.js';

// Mock the provider factory
vi.mock('../manager/ProviderFactory.js');

describe('MultiAgentManager', () => {
  let agentManager: MultiAgentManager;
  let mockProviderFactory: vi.Mocked<ProviderFactory>;
  let mockProviderClient: any;

  beforeEach(() => {
    // Create mock provider client
    mockProviderClient = {
      provider: AIProvider.GEMINI,
      config: {
        provider: AIProvider.GEMINI,
        model: 'gemini-2.0-flash-exp',
        authType: ProviderAuthType.GEMINI_API_KEY,
        enabled: true,
      },
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsImages: true,
        supportsSystemPrompts: true,
        maxContextLength: 2097152,
        supportedModels: ['gemini-2.0-flash-exp'],
      },
      validateConfig: vi.fn().mockResolvedValue(true),
      testConnection: vi.fn().mockResolvedValue(true),
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 100 }),
      getAvailableModels: vi.fn().mockResolvedValue(['gemini-2.0-flash-exp']),
    };

    // Create mock provider factory
    mockProviderFactory = {
      createClient: vi.fn().mockResolvedValue(mockProviderClient),
      clearCache: vi.fn(),
      removeCachedClient: vi.fn(),
      getCachedClientKeys: vi.fn().mockReturnValue([]),
      createClients: vi.fn(),
      getProviderCapabilities: vi.fn(),
      testProviderConfig: vi.fn(),
    };

    // Create agent manager with mocked factory
    agentManager = new MultiAgentManager(5, mockProviderFactory);
  });

  afterEach(async () => {
    await agentManager.shutdown();
  });

  describe('createAgent', () => {
    it('should create a new agent successfully', async () => {
      const agentConfig: AgentConfig = {
        agentId: 'test-agent',
        name: 'Test Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      const agentId = await agentManager.createAgent(agentConfig);
      expect(agentId).toBe('test-agent');

      const agents = await agentManager.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]).toEqual(agentConfig);
    });

    it('should throw error for duplicate agent ID', async () => {
      const agentConfig: AgentConfig = {
        agentId: 'duplicate-agent',
        name: 'Duplicate Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await agentManager.createAgent(agentConfig);

      await expect(agentManager.createAgent(agentConfig))
        .rejects.toThrow('Agent with ID duplicate-agent already exists');
    });

    it('should validate provider configuration', async () => {
      mockProviderClient.validateConfig.mockResolvedValueOnce(false);

      const agentConfig: AgentConfig = {
        agentId: 'invalid-agent',
        name: 'Invalid Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'invalid-model',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await expect(agentManager.createAgent(agentConfig))
        .rejects.toThrow('Invalid provider configuration for agent invalid-agent');
    });

    it('should test connection during creation', async () => {
      mockProviderClient.testConnection.mockResolvedValueOnce(false);

      const agentConfig: AgentConfig = {
        agentId: 'no-connection-agent',
        name: 'No Connection Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await expect(agentManager.createAgent(agentConfig))
        .rejects.toThrow('Cannot connect to provider for agent no-connection-agent');
    });
  });

  describe('startSession', () => {
    beforeEach(async () => {
      const agentConfig: AgentConfig = {
        agentId: 'session-test-agent',
        name: 'Session Test Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await agentManager.createAgent(agentConfig);
    });

    it('should start a new session successfully', async () => {
      const sessionId = await agentManager.startSession('session-test-agent');
      
      expect(sessionId).toMatch(/^session-test-agent-\d+-[a-z0-9]+$/);

      const activeSessions = await agentManager.getActiveSessions();
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].sessionId).toBe(sessionId);
    });

    it('should throw error for non-existent agent', async () => {
      await expect(agentManager.startSession('non-existent-agent'))
        .rejects.toThrow('Agent non-existent-agent not found');
    });

    it('should respect maximum concurrent sessions', async () => {
      // Create a manager with max 1 session
      const limitedManager = new MultiAgentManager(1, mockProviderFactory);

      const agentConfig: AgentConfig = {
        agentId: 'limited-agent',
        name: 'Limited Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await limitedManager.createAgent(agentConfig);
      await limitedManager.startSession('limited-agent');

      // Try to start another session (should fail)
      await expect(limitedManager.startSession('limited-agent'))
        .rejects.toThrow('Maximum concurrent sessions (1) reached');

      await limitedManager.shutdown();
    });
  });

  describe('switchToSession', () => {
    let sessionId: string;

    beforeEach(async () => {
      const agentConfig: AgentConfig = {
        agentId: 'switch-test-agent',
        name: 'Switch Test Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await agentManager.createAgent(agentConfig);
      sessionId = await agentManager.startSession('switch-test-agent');
    });

    it('should switch to existing session', async () => {
      await agentManager.switchToSession(sessionId);
      
      const activeSession = agentManager.getActiveSession();
      expect(activeSession?.sessionId).toBe(sessionId);
    });

    it('should throw error for non-existent session', async () => {
      await expect(agentManager.switchToSession('non-existent-session'))
        .rejects.toThrow('Session non-existent-session not found');
    });
  });

  describe('endSession', () => {
    let sessionId: string;

    beforeEach(async () => {
      const agentConfig: AgentConfig = {
        agentId: 'end-test-agent',
        name: 'End Test Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await agentManager.createAgent(agentConfig);
      sessionId = await agentManager.startSession('end-test-agent');
    });

    it('should end session successfully', async () => {
      await agentManager.endSession(sessionId);

      const activeSessions = await agentManager.getActiveSessions();
      expect(activeSessions).toHaveLength(0);
    });

    it('should throw error for non-existent session', async () => {
      await expect(agentManager.endSession('non-existent-session'))
        .rejects.toThrow('Session non-existent-session not found');
    });
  });

  describe('removeAgent', () => {
    let agentId: string;
    let sessionId: string;

    beforeEach(async () => {
      const agentConfig: AgentConfig = {
        agentId: 'remove-test-agent',
        name: 'Remove Test Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      agentId = await agentManager.createAgent(agentConfig);
      sessionId = await agentManager.startSession(agentId);
    });

    it('should remove agent and its sessions', async () => {
      await agentManager.removeAgent(agentId);

      const agents = await agentManager.listAgents();
      expect(agents).toHaveLength(0);

      const activeSessions = await agentManager.getActiveSessions();
      expect(activeSessions).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const geminiConfig: AgentConfig = {
        agentId: 'gemini-agent',
        name: 'Gemini Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      await agentManager.createAgent(geminiConfig);
      await agentManager.startSession('gemini-agent');

      const stats = agentManager.getStats();

      expect(stats.totalAgents).toBe(1);
      expect(stats.activeAgents).toBe(1);
      expect(stats.totalSessions).toBe(1);
      expect(stats.sessionsByProvider[AIProvider.GEMINI]).toBe(1);
      expect(stats.sessionsByProvider[AIProvider.CLAUDE]).toBe(0);
      expect(stats.sessionsByProvider[AIProvider.OLLAMA]).toBe(0);
    });
  });

  describe('createQuickSession', () => {
    it('should create quick session with default model', async () => {
      const sessionId = await agentManager.createQuickSession(AIProvider.GEMINI);

      expect(sessionId).toMatch(/^quick-gemini-\d+-\d+-[a-z0-9]+$/);

      const agents = await agentManager.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].provider).toBe(AIProvider.GEMINI);

      const activeSessions = await agentManager.getActiveSessions();
      expect(activeSessions).toHaveLength(1);
    });

    it('should create quick session with custom model and name', async () => {
      const sessionId = await agentManager.createQuickSession(
        AIProvider.GEMINI,
        'gemini-1.5-pro',
        'Custom Agent'
      );

      const agents = await agentManager.listAgents();
      expect(agents[0].name).toBe('Custom Agent');
      expect(agents[0].providerConfig.model).toBe('gemini-1.5-pro');
    });
  });
});