/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Part, Tool, createUserContent } from '@google/genai';
import {
  AIProvider,
  ProviderSession,
  ProviderClient,
  UnifiedRequest,
  UnifiedResponse,
} from '../types.js';

/**
 * Base implementation for provider sessions
 */
export class BaseProviderSession implements ProviderSession {
  public history: Content[] = [];
  private tools: Tool[] = [];

  constructor(
    public readonly sessionId: string,
    public readonly provider: AIProvider,
    public readonly client: ProviderClient,
    initialHistory: Content[] = [],
  ) {
    this.history = [...initialHistory];
  }

  async sendMessage(
    message: string | Part[],
    config?: Partial<UnifiedRequest>,
  ): Promise<UnifiedResponse> {
    const userContent = this.createUserContent(message);
    const request = this.buildRequest(userContent, config);

    const response = await this.client.generateContent(
      request,
      this.generatePromptId(),
    );

    // Update history with user input and model response
    this.history.push(userContent);
    if (response.content && response.content.length > 0) {
      this.history.push(...response.content);
    }

    return response;
  }

  async sendMessageStream(
    message: string | Part[],
    config?: Partial<UnifiedRequest>,
  ): Promise<AsyncGenerator<UnifiedResponse>> {
    const userContent = this.createUserContent(message);
    const request = this.buildRequest(userContent, config);

    const responseStream = await this.client.generateContentStream(
      request,
      this.generatePromptId(),
    );

    // Wrap the stream to handle history updates
    return this.wrapStreamWithHistoryUpdate(userContent, responseStream);
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): Content[] {
    return structuredClone(this.history);
  }

  setHistory(history: Content[]): void {
    this.history = structuredClone(history);
  }

  setTools(tools: Tool[]): void {
    this.tools = [...tools];
  }

  /**
   * Create user content from message
   */
  private createUserContent(message: string | Part[]): Content {
    if (typeof message === 'string') {
      return createUserContent(message);
    } else {
      return {
        role: 'user',
        parts: message,
      };
    }
  }

  /**
   * Build unified request from user content and config
   */
  private buildRequest(
    userContent: Content,
    config?: Partial<UnifiedRequest>,
  ): UnifiedRequest {
    const contents = [...this.history, userContent];

    return {
      model: this.client.config.model,
      contents,
      tools: this.tools.length > 0 ? this.tools : undefined,
      temperature: config?.temperature ?? this.client.config.temperature,
      maxTokens: config?.maxTokens ?? this.client.config.maxTokens,
      topP: config?.topP ?? this.client.config.topP,
      stream: config?.stream ?? false,
      ...config,
    };
  }

  /**
   * Generate a unique prompt ID for tracking
   */
  private generatePromptId(): string {
    return `${this.sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Wrap streaming response to update history
   */
  private async *wrapStreamWithHistoryUpdate(
    userContent: Content,
    responseStream: AsyncGenerator<UnifiedResponse>,
  ): AsyncGenerator<UnifiedResponse> {
    const modelContents: Content[] = [];
    let hasAddedUserContent = false;

    try {
      for await (const response of responseStream) {
        if (!hasAddedUserContent) {
          this.history.push(userContent);
          hasAddedUserContent = true;
        }

        if (response.content && response.content.length > 0) {
          modelContents.push(...response.content);
        }

        yield response;
      }

      // Add final model response to history
      if (modelContents.length > 0) {
        this.history.push(...modelContents);
      }
    } catch (error) {
      // Even if streaming fails, we should add the user content to history
      if (!hasAddedUserContent) {
        this.history.push(userContent);
      }
      throw error;
    }
  }

  /**
   * Validate content for the current provider's capabilities
   */
  private validateContent(content: Content): void {
    if (!this.client.capabilities.supportsImages) {
      const hasImages = content.parts?.some(
        (part) => 'inlineData' in part || 'fileData' in part,
      );
      if (hasImages) {
        throw new Error(
          `Provider ${this.provider} does not support image inputs`,
        );
      }
    }
  }

  /**
   * Extract curated history (valid turns only)
   */
  public getCuratedHistory(): Content[] {
    const curatedHistory: Content[] = [];
    
    for (let i = 0; i < this.history.length; i++) {
      const content = this.history[i];
      
      // Validate content before adding to curated history
      if (this.isValidContent(content)) {
        curatedHistory.push(content);
      }
    }
    
    return curatedHistory;
  }

  /**
   * Check if content is valid
   */
  private isValidContent(content: Content): boolean {
    if (!content.parts || content.parts.length === 0) {
      return false;
    }

    for (const part of content.parts) {
      if (!part || Object.keys(part).length === 0) {
        return false;
      }
      
      // Check for empty text parts
      if ('text' in part && part.text === '') {
        return false;
      }
    }

    return true;
  }

  /**
   * Get token count for current history
   */
  public async getHistoryTokenCount(): Promise<number> {
    const result = await this.client.countTokens(this.history);
    return result.totalTokens;
  }

  /**
   * Trim history to fit within token limits
   */
  public async trimHistoryToTokenLimit(maxTokens: number): Promise<void> {
    const currentTokens = await this.getHistoryTokenCount();
    
    if (currentTokens <= maxTokens) {
      return;
    }

    // Remove oldest entries while preserving conversation structure
    while (this.history.length > 2 && await this.getHistoryTokenCount() > maxTokens) {
      // Remove pairs (user + model) to maintain conversation structure
      if (this.history[0]?.role === 'user' && this.history[1]?.role === 'model') {
        this.history.splice(0, 2);
      } else {
        this.history.splice(0, 1);
      }
    }
  }
}