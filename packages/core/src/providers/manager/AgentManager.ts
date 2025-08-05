/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AIProvider,
  AgentConfig,
  AgentManager,
  ProviderSession,
  ProviderClient,
  ProviderError,
} from '../types.js';
import { BaseProviderSession } from '../base/BaseProviderSession.js';
import { ProviderFactory } from './ProviderFactory.js';
import { validateAgentConfig } from '../../config/providerConfig.js';

/**
 * Manages multiple AI agents and their sessions
 */
export class MultiAgentManager implements AgentManager {
  private agents: Map<string, AgentConfig> = new Map();
  private sessions: Map<string, ProviderSession> = new Map();
  private providers: Map<string, ProviderClient> = new Map();
  private activeSessionId: string | null = null;

  constructor(
    private readonly maxConcurrentSessions: number = 5,
    private readonly providerFactory: ProviderFactory = new ProviderFactory(),
  ) {}

  async createAgent(config: AgentConfig): Promise<string> {
    // Validate configuration
    const errors = validateAgentConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid agent configuration: ${errors.join(', ')}`);
    }

    // Check if agent already exists
    if (this.agents.has(config.agentId)) {
      throw new Error(`Agent with ID ${config.agentId} already exists`);
    }

    // Create provider client
    const client = await this.providerFactory.createClient(config.providerConfig);
    
    // Validate provider configuration
    const isValid = await client.validateConfig();
    if (!isValid) {
      throw new Error(`Invalid provider configuration for agent ${config.agentId}`);
    }

    // Test connection
    const canConnect = await client.testConnection();
    if (!canConnect) {
      throw new Error(`Cannot connect to provider for agent ${config.agentId}`);
    }

    // Store agent and provider
    this.agents.set(config.agentId, config);
    this.providers.set(config.agentId, client);

    // Auto-start if configured
    if (config.autoStart) {
      await this.startSession(config.agentId);
    }

    return config.agentId;
  }

  async getAgent(agentId: string): Promise<ProviderSession | null> {
    // Find active session for this agent
    for (const [sessionId, session] of this.sessions) {
      if (sessionId.startsWith(agentId)) {
        return session;
      }
    }
    return null;
  }

  async listAgents(): Promise<AgentConfig[]> {
    return Array.from(this.agents.values());
  }

  async removeAgent(agentId: string): Promise<void> {
    // Remove all sessions for this agent
    const sessionsToRemove: string[] = [];
    for (const [sessionId, session] of this.sessions) {
      if (sessionId.startsWith(agentId)) {
        sessionsToRemove.push(sessionId);
      }
    }

    for (const sessionId of sessionsToRemove) {
      await this.endSession(sessionId);
    }

    // Remove agent and provider
    this.agents.delete(agentId);
    this.providers.delete(agentId);

    // Update active session if needed
    if (this.activeSessionId && this.activeSessionId.startsWith(agentId)) {
      this.activeSessionId = null;
    }
  }

  async startSession(agentId: string): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const provider = this.providers.get(agentId);
    if (!provider) {
      throw new Error(`Provider for agent ${agentId} not found`);
    }

    // Check session limits
    if (this.sessions.size >= this.maxConcurrentSessions) {
      throw new Error(`Maximum concurrent sessions (${this.maxConcurrentSessions}) reached`);
    }

    // Check agent-specific session limits
    const agentSessions = Array.from(this.sessions.entries())
      .filter(([sessionId]) => sessionId.startsWith(agentId));
    
    if (agent.maxSessions && agentSessions.length >= agent.maxSessions) {
      throw new Error(`Maximum sessions for agent ${agentId} (${agent.maxSessions}) reached`);
    }

    // Create session ID
    const sessionId = `${agentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create session
    const session = new BaseProviderSession(
      sessionId,
      agent.provider,
      provider,
    );

    // Set tools if configured
    if (agent.tools && agent.tools.length > 0) {
      session.setTools(agent.tools);
    }

    // Add system prompt if configured
    if (agent.systemPrompt) {
      session.history.push({
        role: 'user',
        parts: [{ text: agent.systemPrompt }],
      });
    }

    this.sessions.set(sessionId, session);

    // Set as active session if none is active
    if (!this.activeSessionId) {
      this.activeSessionId = sessionId;
    }

    return sessionId;
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Clear session history
    session.clearHistory();

    // Remove session
    this.sessions.delete(sessionId);

    // Update active session if needed
    if (this.activeSessionId === sessionId) {
      // Find another active session or set to null
      const remainingSessions = Array.from(this.sessions.keys());
      this.activeSessionId = remainingSessions.length > 0 ? remainingSessions[0] : null;
    }
  }

  async getActiveSessions(): Promise<ProviderSession[]> {
    return Array.from(this.sessions.values());
  }

  async switchToSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }
    this.activeSessionId = sessionId;
  }

  /**
   * Get the currently active session
   */
  getActiveSession(): ProviderSession | null {
    if (!this.activeSessionId) {
      return null;
    }
    return this.sessions.get(this.activeSessionId) || null;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): ProviderSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * List all active session IDs
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get agent configuration by ID
   */
  getAgentConfig(agentId: string): AgentConfig | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * Update agent configuration
   */
  async updateAgent(agentId: string, updates: Partial<AgentConfig>): Promise<void> {
    const existingAgent = this.agents.get(agentId);
    if (!existingAgent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const updatedAgent = { ...existingAgent, ...updates };
    
    // Validate updated configuration
    const errors = validateAgentConfig(updatedAgent);
    if (errors.length > 0) {
      throw new Error(`Invalid agent configuration: ${errors.join(', ')}`);
    }

    // If provider config changed, recreate the client
    if (updates.providerConfig) {
      const newClient = await this.providerFactory.createClient(updatedAgent.providerConfig);
      const isValid = await newClient.validateConfig();
      if (!isValid) {
        throw new Error(`Invalid provider configuration for agent ${agentId}`);
      }
      this.providers.set(agentId, newClient);
    }

    this.agents.set(agentId, updatedAgent);
  }

  /**
   * Get statistics about agents and sessions
   */
  getStats(): {
    totalAgents: number;
    activeAgents: number;
    totalSessions: number;
    sessionsByProvider: Record<AIProvider, number>;
  } {
    const sessionsByProvider: Record<AIProvider, number> = {
      [AIProvider.GEMINI]: 0,
      [AIProvider.CLAUDE]: 0,
      [AIProvider.OLLAMA]: 0,
    };

    for (const session of this.sessions.values()) {
      sessionsByProvider[session.provider]++;
    }

    const activeAgents = new Set();
    for (const sessionId of this.sessions.keys()) {
      const agentId = sessionId.split('-')[0];
      activeAgents.add(agentId);
    }

    return {
      totalAgents: this.agents.size,
      activeAgents: activeAgents.size,
      totalSessions: this.sessions.size,
      sessionsByProvider,
    };
  }

  /**
   * Shutdown all sessions and cleanup
   */
  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    
    for (const sessionId of sessionIds) {
      try {
        await this.endSession(sessionId);
      } catch (error) {
        console.warn(`Error ending session ${sessionId}:`, error);
      }
    }

    this.agents.clear();
    this.providers.clear();
    this.activeSessionId = null;
  }

  /**
   * Create a session with automatic agent creation if needed
   */
  async createQuickSession(
    provider: AIProvider,
    model?: string,
    name?: string,
  ): Promise<string> {
    const agentId = `quick-${provider}-${Date.now()}`;
    const agentName = name || `Quick ${provider} Agent`;

    const config: AgentConfig = {
      agentId,
      name: agentName,
      provider,
      providerConfig: {
        provider,
        model: model || this.getDefaultModel(provider),
        authType: this.getDefaultAuthType(provider),
        enabled: true,
      },
      autoStart: true,
    };

    await this.createAgent(config);
    return this.startSession(agentId);
  }

  private getDefaultModel(provider: AIProvider): string {
    switch (provider) {
      case AIProvider.GEMINI:
        return 'gemini-2.0-flash-exp';
      case AIProvider.CLAUDE:
        return 'claude-3-5-sonnet-20241022';
      case AIProvider.OLLAMA:
        return 'llama2';
    }
  }

  private getDefaultAuthType(provider: AIProvider): any {
    switch (provider) {
      case AIProvider.GEMINI:
        return 'gemini-api-key';
      case AIProvider.CLAUDE:
        return 'claude-api-key';
      case AIProvider.OLLAMA:
        return 'ollama-local';
    }
  }
}