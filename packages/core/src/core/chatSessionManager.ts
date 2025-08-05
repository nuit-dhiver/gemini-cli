/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChatSession,
  ChatSessionFactory,
  ChatGenerationConfig,
  ChatSessionEvent,
  ChatSessionEventType,
  ChatSessionError,
  BaseChatSession,
} from './chatSession.js';
import { AIProvider } from '../providers/types.js';
import { Config } from '../config/config.js';
import { EventEmitter } from 'events';

/**
 * Manages lifecycle of chat sessions and handles provider routing
 */
export class ChatSessionManager extends EventEmitter implements ChatSessionFactory {
  private sessions = new Map<string, ChatSession>();
  private activeSessionId: string | null = null;
  private sessionFactories = new Map<AIProvider, ChatSessionFactory>();

  constructor(private config: Config) {
    super();
    this.setupEventHandlers();
  }

  /**
   * Register a session factory for a specific provider
   */
  registerProvider(provider: AIProvider, factory: ChatSessionFactory): void {
    this.sessionFactories.set(provider, factory);
  }

  /**
   * Create a new chat session
   */
  async createSession(
    provider: AIProvider,
    model: string,
    config?: Partial<ChatGenerationConfig>,
  ): Promise<ChatSession> {
    const factory = this.sessionFactories.get(provider);
    if (!factory) {
      throw new ChatSessionError(
        `No factory registered for provider: ${provider}`,
        'unknown',
        provider,
        'NO_FACTORY',
      );
    }

    const session = await factory.createSession(provider, model, config);
    this.sessions.set(session.sessionId, session);

    // Set as active if no active session
    if (!this.activeSessionId) {
      this.activeSessionId = session.sessionId;
    }

    this.emitEvent(ChatSessionEventType.SessionReset, session.sessionId, {
      provider,
      model,
      config,
    });

    return session;
  }

  /**
   * Get an existing session by ID
   */
  getSession(sessionId: string): ChatSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get the currently active session
   */
  getActiveSession(): ChatSession | null {
    if (!this.activeSessionId) {
      return null;
    }
    return this.getSession(this.activeSessionId);
  }

  /**
   * Set the active session
   */
  setActiveSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new ChatSessionError(
        `Session not found: ${sessionId}`,
        sessionId,
        AIProvider.GEMINI,
        'SESSION_NOT_FOUND',
      );
    }

    const previousSessionId = this.activeSessionId;
    this.activeSessionId = sessionId;

    this.emitEvent(ChatSessionEventType.ProviderSwitched, sessionId, {
      previousSessionId,
      provider: session.provider,
      model: session.model,
    });
  }

  /**
   * List all active sessions
   */
  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Remove a session
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }

    await session.dispose();
    this.sessions.delete(sessionId);

    // If this was the active session, set a new active session
    if (this.activeSessionId === sessionId) {
      const remainingSessions = this.getAllSessions();
      this.activeSessionId = remainingSessions.length > 0 
        ? remainingSessions[0].sessionId 
        : null;
    }
  }

  /**
   * Get supported providers
   */
  getSupportedProviders(): AIProvider[] {
    return Array.from(this.sessionFactories.keys());
  }

  /**
   * Get available models for a provider
   */
  async getAvailableModels(provider: AIProvider): Promise<string[]> {
    const factory = this.sessionFactories.get(provider);
    if (!factory) {
      return [];
    }
    return factory.getAvailableModels(provider);
  }

  /**
   * Create a session using fallback to Gemini if provider unavailable
   */
  async createSessionWithFallback(
    preferredProvider: AIProvider,
    model: string,
    config?: Partial<ChatGenerationConfig>,
  ): Promise<ChatSession> {
    try {
      return await this.createSession(preferredProvider, model, config);
    } catch (error) {
      // Fallback to Gemini if preferred provider fails
      if (preferredProvider !== AIProvider.GEMINI && this.sessionFactories.has(AIProvider.GEMINI)) {
        console.warn(`Failed to create ${preferredProvider} session, falling back to Gemini:`, error);
        return await this.createSession(AIProvider.GEMINI, this.config.getModel(), config);
      }
      throw error;
    }
  }

  /**
   * Health check for all sessions
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    for (const [sessionId, session] of this.sessions) {
      try {
        const isHealthy = await session.isHealthy();
        results.set(sessionId, isHealthy);
      } catch (error) {
        results.set(sessionId, false);
      }
    }

    return results;
  }

  /**
   * Get aggregate statistics across all sessions
   */
  getAggregateStats(): {
    totalSessions: number;
    activeSessions: number;
    messageCount: number;
    totalTokens: number;
    averageResponseTime: number;
    providerDistribution: Map<AIProvider, number>;
  } {
    const stats = {
      totalSessions: this.sessions.size,
      activeSessions: this.sessions.size,
      messageCount: 0,
      totalTokens: 0,
      averageResponseTime: 0,
      providerDistribution: new Map<AIProvider, number>(),
    };

    let totalResponseTime = 0;
    let totalMessages = 0;

    for (const session of this.sessions.values()) {
      const sessionStats = session.getStats();
      
      stats.messageCount += sessionStats.messageCount;
      stats.totalTokens += sessionStats.tokenCount.total;
      totalResponseTime += sessionStats.averageResponseTime * sessionStats.messageCount;
      totalMessages += sessionStats.messageCount;

      const providerCount = stats.providerDistribution.get(session.provider) || 0;
      stats.providerDistribution.set(session.provider, providerCount + 1);
    }

    stats.averageResponseTime = totalMessages > 0 ? totalResponseTime / totalMessages : 0;

    return stats;
  }

  /**
   * Clean up all sessions
   */
  async dispose(): Promise<void> {
    const disposalPromises = Array.from(this.sessions.values()).map(session => 
      session.dispose().catch(error => 
        console.warn(`Error disposing session ${session.sessionId}:`, error)
      )
    );

    await Promise.all(disposalPromises);
    this.sessions.clear();
    this.activeSessionId = null;
    this.removeAllListeners();
  }

  /**
   * Create a session ID
   */
  static generateSessionId(provider: AIProvider, model: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${provider}-${model}-${timestamp}-${random}`;
  }

  /**
   * Setup event handlers for session events
   */
  private setupEventHandlers(): void {
    // Listen for configuration changes
    if (this.config && typeof this.config.on === 'function') {
      this.config.on('modelChanged', async (newModel: string) => {
        const activeSession = this.getActiveSession();
        if (activeSession && activeSession.provider === AIProvider.GEMINI) {
          // Create new session with updated model
          try {
            const newSession = await this.createSession(
              AIProvider.GEMINI,
              newModel,
            );
            this.setActiveSession(newSession.sessionId);
          } catch (error) {
            console.warn('Failed to create session with new model:', error);
          }
        }
      });
    }
  }

  /**
   * Emit a session event
   */
  private emitEvent(
    type: ChatSessionEventType,
    sessionId: string,
    data?: any,
  ): void {
    const session = this.getSession(sessionId);
    const event: ChatSessionEvent = {
      type,
      sessionId,
      provider: session?.provider || AIProvider.GEMINI,
      timestamp: Date.now(),
      data,
    };

    this.emit('sessionEvent', event);
    this.emit(type, event);
  }
}

/**
 * Singleton session manager instance
 */
let globalSessionManager: ChatSessionManager | null = null;

/**
 * Get or create the global session manager
 */
export function getSessionManager(config?: Config): ChatSessionManager {
  if (!globalSessionManager && config) {
    globalSessionManager = new ChatSessionManager(config);
  }
  
  if (!globalSessionManager) {
    throw new Error('Session manager not initialized - Config required for first call');
  }
  
  return globalSessionManager;
}

/**
 * Initialize the global session manager
 */
export function initializeSessionManager(config: Config): ChatSessionManager {
  globalSessionManager = new ChatSessionManager(config);
  return globalSessionManager;
}

/**
 * Reset the global session manager (primarily for testing)
 */
export function resetSessionManager(): void {
  if (globalSessionManager) {
    globalSessionManager.dispose().catch(console.warn);
    globalSessionManager = null;
  }
}