/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AgentManager,
  AgentConfig,
  ProviderSession,
  AIProvider,
  MultiAgentManager,
  ProviderFactory,
} from '@google/gemini-cli-core';

interface AgentManagerState {
  agentManager: AgentManager | null;
  agents: AgentConfig[];
  activeSessions: ProviderSession[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  loading: boolean;
  error: string | null;
}

interface AgentManagerHook extends AgentManagerState {
  createAgent: (config: AgentConfig) => Promise<void>;
  removeAgent: (agentId: string) => Promise<void>;
  switchToAgent: (agentId: string) => Promise<void>;
  switchToSession: (sessionId: string) => Promise<void>;
  endSession: (sessionId: string) => Promise<void>;
  createQuickSession: (provider: AIProvider, model?: string, name?: string) => Promise<void>;
  refreshState: () => Promise<void>;
  getStats: () => any;
}

/**
 * Hook for managing multiple AI agents and sessions
 */
export function useAgentManager(
  maxConcurrentSessions: number = 5
): AgentManagerHook {
  const [state, setState] = useState<AgentManagerState>({
    agentManager: null,
    agents: [],
    activeSessions: [],
    activeSessionId: null,
    activeAgentId: null,
    loading: true,
    error: null,
  });

  const agentManagerRef = useRef<AgentManager | null>(null);

  // Initialize agent manager
  useEffect(() => {
    async function initializeManager() {
      try {
        const providerFactory = new ProviderFactory();
        const manager = new MultiAgentManager(maxConcurrentSessions, providerFactory);
        
        agentManagerRef.current = manager;
        
        setState(prev => ({
          ...prev,
          agentManager: manager,
          loading: false,
        }));

        // Initial state refresh
        await refreshStateInternal(manager);
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        }));
      }
    }

    initializeManager();

    // Cleanup on unmount
    return () => {
      if (agentManagerRef.current) {
        (agentManagerRef.current as any).shutdown?.();
      }
    };
  }, [maxConcurrentSessions]);

  // Refresh state from agent manager
  const refreshStateInternal = async (manager: AgentManager) => {
    try {
      const [agents, activeSessions] = await Promise.all([
        manager.listAgents(),
        manager.getActiveSessions(),
      ]);

      // Find active session and agent
      const activeSession = activeSessions.find(session => 
        (manager as any).activeSessionId === session.sessionId
      );
      
      const activeAgentId = activeSession
        ? activeSession.sessionId.split('-')[0]
        : null;

      setState(prev => ({
        ...prev,
        agents,
        activeSessions,
        activeSessionId: activeSession?.sessionId || null,
        activeAgentId,
        error: null,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const refreshState = useCallback(async () => {
    if (agentManagerRef.current) {
      await refreshStateInternal(agentManagerRef.current);
    }
  }, []);

  const createAgent = useCallback(async (config: AgentConfig) => {
    if (!agentManagerRef.current) {
      throw new Error('Agent manager not initialized');
    }

    try {
      await agentManagerRef.current.createAgent(config);
      await refreshStateInternal(agentManagerRef.current);
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, []);

  const removeAgent = useCallback(async (agentId: string) => {
    if (!agentManagerRef.current) {
      throw new Error('Agent manager not initialized');
    }

    try {
      await agentManagerRef.current.removeAgent(agentId);
      await refreshStateInternal(agentManagerRef.current);
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, []);

  const switchToAgent = useCallback(async (agentId: string) => {
    if (!agentManagerRef.current) {
      throw new Error('Agent manager not initialized');
    }

    try {
      // Check if agent already has a session
      const existingSession = await agentManagerRef.current.getAgent(agentId);
      let sessionId: string;

      if (existingSession) {
        sessionId = existingSession.sessionId;
      } else {
        sessionId = await agentManagerRef.current.startSession(agentId);
      }

      await agentManagerRef.current.switchToSession(sessionId);
      await refreshStateInternal(agentManagerRef.current);
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, []);

  const switchToSession = useCallback(async (sessionId: string) => {
    if (!agentManagerRef.current) {
      throw new Error('Agent manager not initialized');
    }

    try {
      await agentManagerRef.current.switchToSession(sessionId);
      await refreshStateInternal(agentManagerRef.current);
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, []);

  const endSession = useCallback(async (sessionId: string) => {
    if (!agentManagerRef.current) {
      throw new Error('Agent manager not initialized');
    }

    try {
      await agentManagerRef.current.endSession(sessionId);
      await refreshStateInternal(agentManagerRef.current);
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, []);

  const createQuickSession = useCallback(async (
    provider: AIProvider,
    model?: string,
    name?: string
  ) => {
    if (!agentManagerRef.current) {
      throw new Error('Agent manager not initialized');
    }

    try {
      const sessionId = await (agentManagerRef.current as any).createQuickSession(
        provider,
        model,
        name
      );
      await refreshStateInternal(agentManagerRef.current);
      return sessionId;
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, []);

  const getStats = useCallback(() => {
    if (!agentManagerRef.current) {
      return null;
    }

    return (agentManagerRef.current as any).getStats?.() || null;
  }, []);

  return {
    ...state,
    createAgent,
    removeAgent,
    switchToAgent,
    switchToSession,
    endSession,
    createQuickSession,
    refreshState,
    getStats,
  };
}