/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useEffect, useState } from 'react';
import * as React from 'react';
import {
  Config,
  GeminiClient,
  EditorType,
} from '@google/gemini-cli-core';
import { type PartListUnion } from '@google/genai';
import {
  HistoryItem,
  SlashCommandProcessorResult,
} from '../types.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useChatStream, UseChatStreamConfig } from './useChatStream.js';

/**
 * Backward compatibility adapter for useGeminiStream
 * 
 * This hook provides the same interface as the original useGeminiStream
 * but internally uses the new provider-agnostic useChatStream hook.
 * 
 * @deprecated Use useChatStream directly for new code
 */
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
  modelSwitchedFromQuotaError: boolean,
  setModelSwitchedFromQuotaError: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  // Convert GeminiClient to ChatSession
  const chatSession = useMemo(async () => {
    return geminiClient.getChatSession();
  }, [geminiClient]);

  // Use the new useChatStream hook with Gemini-specific configuration
  const streamConfig: UseChatStreamConfig = {
    provider: 'gemini' as any, // AIProvider.GEMINI
    model: config.getModel(),
    sessionId: config.getSessionId(),
    enableThoughts: true,
    enableToolCalls: true,
  };

  // We need to handle the async nature of getChatSession
  const [resolvedChatSession, setResolvedChatSession] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    chatSession.then(session => {
      if (mounted) {
        setResolvedChatSession(session);
      }
    });
    return () => { mounted = false; };
  }, [chatSession]);

  const result = useChatStream(
    resolvedChatSession || {
      // Fallback implementation that delegates to GeminiClient
      provider: 'gemini' as any,
      model: config.getModel(),
      sessionId: config.getSessionId(),
      sendMessageStream: async (params: any, promptId: string) => {
        return geminiClient.sendMessageStream(params.message, params.config?.abortSignal, promptId);
      },
      getHistory: () => geminiClient.getHistory(),
      addHistory: (content: any) => geminiClient.addHistory(content),
    } as any,
    history,
    addItem,
    config,
    onDebugMessage,
    handleSlashCommand,
    shellModeActive,
    getPreferredEditor,
    onAuthError,
    performMemoryRefresh,
    modelSwitchedFromQuotaError,
    setModelSwitchedFromQuotaError,
    streamConfig,
  );

  // Return the same interface as the original useGeminiStream
  return {
    streamingState: result.streamingState,
    submitQuery: result.submitQuery,
    initError: result.initError,
    pendingHistoryItems: result.pendingHistoryItems,
    thought: result.thought,
  };
};

// Re-export the merge function for compatibility
export { mergePartListUnions } from './useChatStream.js';