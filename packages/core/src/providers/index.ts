/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Core types and interfaces
export * from './types.js';

// Base classes
export * from './base/BaseProviderClient.js';
export * from './base/BaseProviderSession.js';

// Provider implementations
export * from './gemini/GeminiProviderClient.js';
export * from './claude/ClaudeProviderClient.js';
export * from './ollama/OllamaProviderClient.js';

// Management and factory classes
export * from './manager/AgentManager.js';
export * from './manager/ProviderFactory.js';

// Integration layer
export * from './integration/MultiProviderChat.js';

// Configuration
export * from '../config/providerConfig.js';