/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Tool, GenerateContentResponse } from '@google/genai';
import {
  AIProvider,
  ProviderSession,
  AgentManager,
  UnifiedResponse,
  UnifiedRequest,
} from '../types.js';
import { GeminiChat } from '../../core/geminiChat.js';
import { Config } from '../../config/config.js';
import { ContentGenerator } from '../../core/contentGenerator.js';

/**
 * Adapter that allows the existing GeminiChat interface to work with multiple providers
 */
export class MultiProviderChat {
  private activeSession: ProviderSession | null = null;
  private tools: Tool[] = [];

  constructor(
    private config: Config,
    private agentManager: AgentManager,
    private fallbackGeminiChat?: GeminiChat,
  ) {}

  /**
   * Set the active session for this chat
   */
  setActiveSession(session: ProviderSession | null): void {
    this.activeSession = session;
    
    // Update tools if session changed
    if (session && this.tools.length > 0) {
      session.setTools(this.tools);
    }
  }

  /**
   * Get the currently active session
   */
  getActiveSession(): ProviderSession | null {
    return this.activeSession;
  }

  /**
   * Send message using the active provider session or fallback to Gemini
   */
  async sendMessage(
    params: { message: string | Content; config?: any },
    promptId: string,
  ): Promise<GenerateContentResponse> {
    if (this.activeSession) {
      // Use the multi-provider session
      const response = await this.sendMessageViaProvider(params, promptId);
      return this.convertUnifiedToGeminiResponse(response);
    } else if (this.fallbackGeminiChat) {
      // Fallback to original Gemini implementation
      return this.fallbackGeminiChat.sendMessage(params, promptId);
    } else {
      throw new Error('No active provider session or fallback available');
    }
  }

  /**
   * Send streaming message using the active provider session or fallback to Gemini
   */
  async sendMessageStream(
    params: { message: string | Content; config?: any },
    promptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    if (this.activeSession) {
      // Use the multi-provider session
      const streamResponse = await this.sendMessageStreamViaProvider(params, promptId);
      return this.convertUnifiedStreamToGemini(streamResponse);
    } else if (this.fallbackGeminiChat) {
      // Fallback to original Gemini implementation
      return this.fallbackGeminiChat.sendMessageStream(params, promptId);
    } else {
      throw new Error('No active provider session or fallback available');
    }
  }

  /**
   * Get conversation history from active session or fallback
   */
  getHistory(curated: boolean = false): Content[] {
    if (this.activeSession) {
      return curated 
        ? (this.activeSession as any).getCuratedHistory?.() || this.activeSession.getHistory()
        : this.activeSession.getHistory();
    } else if (this.fallbackGeminiChat) {
      return this.fallbackGeminiChat.getHistory(curated);
    } else {
      return [];
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    if (this.activeSession) {
      this.activeSession.clearHistory();
    } else if (this.fallbackGeminiChat) {
      this.fallbackGeminiChat.clearHistory();
    }
  }

  /**
   * Add content to history
   */
  addHistory(content: Content): void {
    if (this.activeSession) {
      // For provider sessions, we need to add to history manually
      const currentHistory = this.activeSession.getHistory();
      this.activeSession.setHistory([...currentHistory, content]);
    } else if (this.fallbackGeminiChat) {
      this.fallbackGeminiChat.addHistory(content);
    }
  }

  /**
   * Set conversation history
   */
  setHistory(history: Content[]): void {
    if (this.activeSession) {
      this.activeSession.setHistory(history);
    } else if (this.fallbackGeminiChat) {
      this.fallbackGeminiChat.setHistory(history);
    }
  }

  /**
   * Set tools for the conversation
   */
  setTools(tools: Tool[]): void {
    this.tools = tools;
    
    if (this.activeSession) {
      this.activeSession.setTools(tools);
    } else if (this.fallbackGeminiChat) {
      this.fallbackGeminiChat.setTools(tools);
    }
  }

  /**
   * Get final usage metadata from chunks (for streaming)
   */
  getFinalUsageMetadata(chunks: GenerateContentResponse[]) {
    if (this.fallbackGeminiChat) {
      return this.fallbackGeminiChat.getFinalUsageMetadata(chunks);
    }
    
    // For multi-provider, extract from the last chunk
    const lastChunk = chunks
      .slice()
      .reverse()
      .find(chunk => chunk.usageMetadata);
    
    return lastChunk?.usageMetadata;
  }

  /**
   * Send message via active provider session
   */
  private async sendMessageViaProvider(
    params: { message: string | Content; config?: any },
    promptId: string,
  ): Promise<UnifiedResponse> {
    if (!this.activeSession) {
      throw new Error('No active provider session');
    }

    // Convert message to the format expected by provider sessions
    let message: string | import('@google/genai').Part[];
    
    if (typeof params.message === 'string') {
      message = params.message;
    } else {
      // Convert Content to Parts
      message = params.message.parts || [];
    }

    const unifiedConfig: Partial<UnifiedRequest> = {
      temperature: params.config?.temperature,
      maxTokens: params.config?.maxOutputTokens,
      topP: params.config?.topP,
      tools: params.config?.tools || this.tools,
    };

    return this.activeSession.sendMessage(message, unifiedConfig);
  }

  /**
   * Send streaming message via active provider session
   */
  private async sendMessageStreamViaProvider(
    params: { message: string | Content; config?: any },
    promptId: string,
  ): Promise<AsyncGenerator<UnifiedResponse>> {
    if (!this.activeSession) {
      throw new Error('No active provider session');
    }

    // Convert message to the format expected by provider sessions
    let message: string | import('@google/genai').Part[];
    
    if (typeof params.message === 'string') {
      message = params.message;
    } else {
      // Convert Content to Parts
      message = params.message.parts || [];
    }

    const unifiedConfig: Partial<UnifiedRequest> = {
      temperature: params.config?.temperature,
      maxTokens: params.config?.maxOutputTokens,
      topP: params.config?.topP,
      tools: params.config?.tools || this.tools,
      stream: true,
    };

    return this.activeSession.sendMessageStream(message, unifiedConfig);
  }

  /**
   * Convert unified response to Gemini format
   */
  private convertUnifiedToGeminiResponse(response: UnifiedResponse): GenerateContentResponse {
    return {
      candidates: response.content.map(content => ({
        content,
        finishReason: response.finishReason,
        index: 0,
      })),
      usageMetadata: response.usageMetadata,
      modelVersion: response.model,
    } as GenerateContentResponse;
  }

  /**
   * Convert unified stream to Gemini format
   */
  private async *convertUnifiedStreamToGemini(
    stream: AsyncGenerator<UnifiedResponse>,
  ): AsyncGenerator<GenerateContentResponse> {
    for await (const response of stream) {
      yield this.convertUnifiedToGeminiResponse(response);
    }
  }

  /**
   * Get information about the active provider
   */
  getActiveProviderInfo(): {
    provider: AIProvider | null;
    model: string | null;
    sessionId: string | null;
  } {
    if (this.activeSession) {
      return {
        provider: this.activeSession.provider,
        model: this.activeSession.client.config.model,
        sessionId: this.activeSession.sessionId,
      };
    }
    
    return {
      provider: null,
      model: null,
      sessionId: null,
    };
  }

  /**
   * Check if using multi-provider mode
   */
  isMultiProviderMode(): boolean {
    return this.activeSession !== null;
  }

  /**
   * Switch to a specific provider session
   */
  async switchToProvider(sessionId: string): Promise<void> {
    await this.agentManager.switchToSession(sessionId);
    
    // Get the active session after switching
    const sessions = await this.agentManager.getActiveSessions();
    this.activeSession = sessions.find(s => s.sessionId === sessionId) || null;
    
    // Apply current tools to the new session
    if (this.activeSession && this.tools.length > 0) {
      this.activeSession.setTools(this.tools);
    }
  }

  /**
   * Create a quick session with a specific provider
   */
  async createQuickSession(
    provider: AIProvider,
    model?: string,
    name?: string,
  ): Promise<string> {
    const sessionId = await (this.agentManager as any).createQuickSession?.(
      provider,
      model,
      name
    );
    
    if (sessionId) {
      await this.switchToProvider(sessionId);
    }
    
    return sessionId;
  }

  /**
   * Get statistics about current usage
   */
  getStats(): any {
    return (this.agentManager as any).getStats?.();
  }
}