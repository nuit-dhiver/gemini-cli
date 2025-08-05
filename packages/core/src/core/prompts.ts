/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-agnostic prompt interface
 * 
 * This module defines the interfaces for system prompts that can be implemented
 * by different AI providers (Gemini, Claude, Ollama, etc.)
 * 
 * Provider-specific implementations should be in their respective adapter modules:
 * - Gemini: packages/core/src/providers/gemini/GeminiConfig.ts
 * - Claude: packages/core/src/providers/claude/ClaudeConfig.ts (future)
 * - Ollama: packages/core/src/providers/ollama/OllamaConfig.ts (future)
 */

/**
 * Base interface for system prompt configuration
 */
export interface SystemPromptConfig {
  enabled: boolean;
  customPath?: string;
  writeToFile?: boolean;
  writeToCustomPath?: string;
}

/**
 * Interface for provider-specific prompt generation
 */
export interface PromptProvider {
  getSystemPrompt(userMemory?: string, config?: Partial<SystemPromptConfig>): string;
  getCompressionPrompt?(): string;
}

/**
 * Generic system prompt function that delegates to provider-specific implementations
 * 
 * @deprecated Use provider-specific getSystemPrompt methods instead
 * For backward compatibility, this function delegates to Gemini provider
 */
export function getCoreSystemPrompt(userMemory?: string): string {
  // For backward compatibility, delegate to Gemini provider
  // In the future, this should be removed and callers should use provider-specific methods
  try {
    const { getGeminiSystemPrompt } = require('../providers/gemini/GeminiConfig.js');
    return getGeminiSystemPrompt(userMemory);
  } catch (error) {
    throw new Error(
      'getCoreSystemPrompt is deprecated. Please use provider-specific system prompt methods. ' +
      'For Gemini: import { getGeminiSystemPrompt } from "../providers/gemini/GeminiConfig.js"'
    );
  }
}

/**
 * Provides the system prompt for the history compression process.
 * This prompt instructs the model to act as a specialized state manager,
 * think in a scratchpad, and produce a structured XML summary.
 * 
 * @deprecated Use provider-specific compression prompts
 */
export function getCompressionPrompt(): string {
  // For backward compatibility, delegate to Gemini provider
  try {
    const { getGeminiCompressionPrompt } = require('../providers/gemini/GeminiConfig.js');
    return getGeminiCompressionPrompt();
  } catch (error) {
    throw new Error(
      'getCompressionPrompt is deprecated. Please use provider-specific compression prompt methods. ' +
      'For Gemini: import { getGeminiCompressionPrompt } from "../providers/gemini/GeminiConfig.js"'
    );
  }
}