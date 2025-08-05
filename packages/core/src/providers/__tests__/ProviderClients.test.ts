/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiProviderClient } from '../gemini/GeminiProviderClient.js';
import { ClaudeProviderClient } from '../claude/ClaudeProviderClient.js';
import { OllamaProviderClient } from '../ollama/OllamaProviderClient.js';
import {
  AIProvider,
  ProviderAuthType,
  ProviderConfig,
  UnifiedRequest,
} from '../types.js';

// Mock fetch for HTTP requests
global.fetch = vi.fn();

describe('Provider Clients', () => {
  describe('GeminiProviderClient', () => {
    let client: GeminiProviderClient;
    let config: ProviderConfig;

    beforeEach(() => {
      config = {
        provider: AIProvider.GEMINI,
        model: 'gemini-2.0-flash-exp',
        authType: ProviderAuthType.GEMINI_API_KEY,
        apiKey: 'test-api-key',
        enabled: true,
      };

      client = new GeminiProviderClient(config);
    });

    it('should have correct provider and capabilities', () => {
      expect(client.provider).toBe(AIProvider.GEMINI);
      expect(client.capabilities.supportsStreaming).toBe(true);
      expect(client.capabilities.supportsTools).toBe(true);
      expect(client.capabilities.supportsImages).toBe(true);
      expect(client.capabilities.maxContextLength).toBe(2097152);
    });

    it('should validate request against capabilities', () => {
      const request: UnifiedRequest = {
        model: 'unsupported-model',
        contents: [],
      };

      expect(() => client.validateRequest(request)).toThrow(
        'Model unsupported-model is not supported by provider gemini'
      );
    });

    it('should estimate tokens correctly', () => {
      const contents = [
        {
          role: 'user' as const,
          parts: [{ text: 'Hello world, this is a test message' }],
        },
      ];

      const tokens = (client as any).estimateTokens(contents);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20); // Rough estimate for the text
    });
  });

  describe('ClaudeProviderClient', () => {
    let client: ClaudeProviderClient;
    let config: ProviderConfig;

    beforeEach(() => {
      config = {
        provider: AIProvider.CLAUDE,
        model: 'claude-3-5-sonnet-20241022',
        authType: ProviderAuthType.CLAUDE_API_KEY,
        apiKey: 'test-api-key',
        endpoint: 'https://api.anthropic.com/v1/messages',
        enabled: true,
      };

      client = new ClaudeProviderClient(config);
    });

    it('should have correct provider and capabilities', () => {
      expect(client.provider).toBe(AIProvider.CLAUDE);
      expect(client.capabilities.supportsStreaming).toBe(true);
      expect(client.capabilities.supportsTools).toBe(true);
      expect(client.capabilities.supportsImages).toBe(true);
      expect(client.capabilities.maxContextLength).toBe(200000);
    });

    it('should require API key', () => {
      const configWithoutKey = { ...config, apiKey: undefined };
      process.env.ANTHROPIC_API_KEY = '';

      expect(() => new ClaudeProviderClient(configWithoutKey))
        .toThrow('Claude API key is required');
    });

    it('should convert unified request to Claude format', () => {
      const request: UnifiedRequest = {
        model: 'claude-3-5-sonnet-20241022',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello, how are you?' }],
          },
        ],
        temperature: 0.7,
        maxTokens: 1000,
      };

      const claudeRequest = (client as any).convertFromUnifiedRequest(request);

      expect(claudeRequest.model).toBe('claude-3-5-sonnet-20241022');
      expect(claudeRequest.max_tokens).toBe(1000);
      expect(claudeRequest.temperature).toBe(0.7);
      expect(claudeRequest.messages).toHaveLength(1);
      expect(claudeRequest.messages[0].role).toBe('user');
      expect(claudeRequest.messages[0].content).toBe('Hello, how are you?');
    });

    it('should extract system prompt from messages', () => {
      const request: UnifiedRequest = {
        model: 'claude-3-5-sonnet-20241022',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'You are a helpful assistant' }],
          },
          {
            role: 'user',
            parts: [{ text: 'What is the weather today?' }],
          },
        ],
      };

      const claudeRequest = (client as any).convertFromUnifiedRequest(request);

      expect(claudeRequest.system).toBe('You are a helpful assistant');
      expect(claudeRequest.messages).toHaveLength(1);
      expect(claudeRequest.messages[0].content).toBe('What is the weather today?');
    });
  });

  describe('OllamaProviderClient', () => {
    let client: OllamaProviderClient;
    let config: ProviderConfig;

    beforeEach(() => {
      config = {
        provider: AIProvider.OLLAMA,
        model: 'llama2',
        authType: ProviderAuthType.OLLAMA_LOCAL,
        endpoint: 'http://localhost:11434',
        enabled: true,
      };

      client = new OllamaProviderClient(config);
    });

    it('should have correct provider and capabilities', () => {
      expect(client.provider).toBe(AIProvider.OLLAMA);
      expect(client.capabilities.supportsStreaming).toBe(true);
      expect(client.capabilities.supportsTools).toBe(false);
      expect(client.capabilities.supportsImages).toBe(true);
      expect(client.capabilities.maxContextLength).toBe(8192);
    });

    it('should set correct endpoint', () => {
      expect((client as any).endpoint).toBe('http://localhost:11434/api');
    });

    it('should use default endpoint from environment', () => {
      const configWithoutEndpoint = { ...config, endpoint: undefined };
      process.env.OLLAMA_HOST = 'http://custom-host:8080';

      const clientWithEnv = new OllamaProviderClient(configWithoutEndpoint);
      expect((clientWithEnv as any).endpoint).toBe('http://custom-host:8080/api');

      delete process.env.OLLAMA_HOST;
    });

    it('should convert unified request to Ollama format', () => {
      const request: UnifiedRequest = {
        model: 'llama2',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello, how are you?' }],
          },
          {
            role: 'model',
            parts: [{ text: 'I am doing well, thank you!' }],
          },
        ],
        temperature: 0.8,
        maxTokens: 500,
      };

      const ollamaRequest = (client as any).convertFromUnifiedRequest(request);

      expect(ollamaRequest.model).toBe('llama2');
      expect(ollamaRequest.messages).toHaveLength(2);
      expect(ollamaRequest.messages[0].role).toBe('user');
      expect(ollamaRequest.messages[0].content).toBe('Hello, how are you?');
      expect(ollamaRequest.messages[1].role).toBe('assistant');
      expect(ollamaRequest.messages[1].content).toBe('I am doing well, thank you!');
      expect(ollamaRequest.options.temperature).toBe(0.8);
      expect(ollamaRequest.options.num_predict).toBe(500);
    });

    it('should extract images from parts', () => {
      const request: UnifiedRequest = {
        model: 'llava',
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'What do you see in this image?' },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: 'base64-image-data',
                },
              } as any,
            ],
          },
        ],
      };

      const ollamaRequest = (client as any).convertFromUnifiedRequest(request);

      expect(ollamaRequest.messages[0].content).toBe('What do you see in this image?');
      expect(ollamaRequest.messages[0].images).toEqual(['base64-image-data']);
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', () => {
      const config: ProviderConfig = {
        provider: AIProvider.CLAUDE,
        model: 'claude-3-5-sonnet-20241022',
        authType: ProviderAuthType.CLAUDE_API_KEY,
        apiKey: '',
        enabled: true,
      };

      process.env.ANTHROPIC_API_KEY = '';

      expect(() => new ClaudeProviderClient(config))
        .toThrow('Claude API key is required');
    });

    it('should handle network errors gracefully', async () => {
      const config: ProviderConfig = {
        provider: AIProvider.CLAUDE,
        model: 'claude-3-5-sonnet-20241022',
        authType: ProviderAuthType.CLAUDE_API_KEY,
        apiKey: 'test-key',
        endpoint: 'https://api.anthropic.com/v1/messages',
        enabled: true,
      };

      const client = new ClaudeProviderClient(config);

      // Mock fetch to throw network error
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const request: UnifiedRequest = {
        model: 'claude-3-5-sonnet-20241022',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      };

      await expect(client.generateContent(request, 'test-prompt'))
        .rejects.toThrow('Network error');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens for different providers', () => {
      const contents = [
        {
          role: 'user' as const,
          parts: [{ text: 'This is a test message with multiple words' }],
        },
      ];

      const geminiClient = new GeminiProviderClient({
        provider: AIProvider.GEMINI,
        model: 'gemini-2.0-flash-exp',
        authType: ProviderAuthType.GEMINI_API_KEY,
        enabled: true,
      });

      const claudeClient = new ClaudeProviderClient({
        provider: AIProvider.CLAUDE,
        model: 'claude-3-5-sonnet-20241022',
        authType: ProviderAuthType.CLAUDE_API_KEY,
        apiKey: 'test-key',
        enabled: true,
      });

      const ollamaClient = new OllamaProviderClient({
        provider: AIProvider.OLLAMA,
        model: 'llama2',
        authType: ProviderAuthType.OLLAMA_LOCAL,
        enabled: true,
      });

      const geminiTokens = (geminiClient as any).estimateTokens(contents);
      const claudeTokens = (claudeClient as any).estimateTokens(contents);
      const ollamaTokens = (ollamaClient as any).estimateTokens(contents);

      // All should provide reasonable estimates
      expect(geminiTokens).toBeGreaterThan(0);
      expect(claudeTokens).toBeGreaterThan(0);
      expect(ollamaTokens).toBeGreaterThan(0);

      // Claude should have slightly higher token count due to different ratio
      expect(claudeTokens).toBeGreaterThanOrEqual(geminiTokens);
    });
  });
});