/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AIProvider,
  ProviderAuthType,
  ProviderConfig,
  AgentConfig,
} from '../providers/types.js';

/**
 * Multi-provider configuration structure
 */
export interface MultiProviderConfig {
  providers: Record<AIProvider, ProviderConfig>;
  agents: AgentConfig[];
  defaultProvider: AIProvider;
  activeAgents: string[];
  maxConcurrentSessions: number;
  globalSettings: {
    enableAutoSwitching: boolean;
    enableLoadBalancing: boolean;
    enableFallback: boolean;
    telemetryEnabled: boolean;
  };
}

/**
 * Default configurations for each provider
 */
export const DEFAULT_PROVIDER_CONFIGS: Record<AIProvider, Partial<ProviderConfig>> = {
  [AIProvider.GEMINI]: {
    provider: AIProvider.GEMINI,
    model: 'gemini-2.0-flash-exp',
    authType: ProviderAuthType.GEMINI_API_KEY,
    enabled: true,
    maxTokens: 8192,
    temperature: 0.7,
    topP: 0.95,
  },
  [AIProvider.CLAUDE]: {
    provider: AIProvider.CLAUDE,
    model: 'claude-3-5-sonnet-20241022',
    authType: ProviderAuthType.CLAUDE_API_KEY,
    enabled: false,
    maxTokens: 8192,
    temperature: 0.7,
    topP: 0.95,
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  [AIProvider.OLLAMA]: {
    provider: AIProvider.OLLAMA,
    model: 'llama2',
    authType: ProviderAuthType.OLLAMA_LOCAL,
    enabled: false,
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.95,
    endpoint: 'http://localhost:11434',
  },
};

/**
 * Model mappings for different providers
 */
export const PROVIDER_MODELS: Record<AIProvider, string[]> = {
  [AIProvider.GEMINI]: [
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.0-pro',
  ],
  [AIProvider.CLAUDE]: [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ],
  [AIProvider.OLLAMA]: [
    'llama2',
    'llama2:13b',
    'llama2:70b',
    'codellama',
    'codellama:13b',
    'codellama:34b',
    'mistral',
    'mixtral',
    'phi',
    'neural-chat',
    'starling-lm',
  ],
};

/**
 * Create default multi-provider configuration
 */
export function createDefaultMultiProviderConfig(): MultiProviderConfig {
  const providers: Record<AIProvider, ProviderConfig> = {} as any;

  // Initialize all providers with defaults
  for (const [providerKey, defaultConfig] of Object.entries(DEFAULT_PROVIDER_CONFIGS)) {
    const provider = providerKey as AIProvider;
    providers[provider] = {
      ...defaultConfig,
      provider,
      model: defaultConfig.model!,
      authType: defaultConfig.authType!,
      enabled: provider === AIProvider.GEMINI, // Only Gemini enabled by default
    } as ProviderConfig;
  }

  return {
    providers,
    agents: [],
    defaultProvider: AIProvider.GEMINI,
    activeAgents: [],
    maxConcurrentSessions: 5,
    globalSettings: {
      enableAutoSwitching: false,
      enableLoadBalancing: false,
      enableFallback: true,
      telemetryEnabled: true,
    },
  };
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];

  if (!config.provider) {
    errors.push('Provider is required');
  }

  if (!config.model) {
    errors.push('Model is required');
  }

  if (!config.authType) {
    errors.push('Auth type is required');
  }

  // Provider-specific validations
  switch (config.provider) {
    case AIProvider.GEMINI:
      if (
        config.authType === ProviderAuthType.GEMINI_API_KEY ||
        config.authType === ProviderAuthType.VERTEX_AI
      ) {
        if (!config.apiKey && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
          errors.push('API key is required for Gemini API key authentication');
        }
      }
      break;

    case AIProvider.CLAUDE:
      if (config.authType === ProviderAuthType.CLAUDE_API_KEY) {
        if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
          errors.push('API key is required for Claude authentication');
        }
      }
      if (!config.endpoint) {
        errors.push('Endpoint is required for Claude');
      }
      break;

    case AIProvider.OLLAMA:
      if (!config.endpoint) {
        errors.push('Endpoint is required for Ollama');
      }
      break;
  }

  // Validate model is supported
  if (config.provider && config.model) {
    const supportedModels = PROVIDER_MODELS[config.provider];
    if (!supportedModels.includes(config.model)) {
      errors.push(`Model ${config.model} is not supported by ${config.provider}`);
    }
  }

  // Validate numeric values
  if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
    errors.push('Temperature must be between 0 and 2');
  }

  if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
    errors.push('TopP must be between 0 and 1');
  }

  if (config.maxTokens !== undefined && config.maxTokens < 1) {
    errors.push('MaxTokens must be greater than 0');
  }

  return errors;
}

/**
 * Validate agent configuration
 */
export function validateAgentConfig(config: AgentConfig): string[] {
  const errors: string[] = [];

  if (!config.agentId) {
    errors.push('Agent ID is required');
  }

  if (!config.name) {
    errors.push('Agent name is required');
  }

  if (!config.provider) {
    errors.push('Provider is required');
  }

  if (!config.providerConfig) {
    errors.push('Provider configuration is required');
  } else {
    // Validate nested provider config
    const providerErrors = validateProviderConfig(config.providerConfig);
    errors.push(...providerErrors.map(err => `Provider config: ${err}`));
  }

  if (config.maxSessions !== undefined && config.maxSessions < 1) {
    errors.push('MaxSessions must be greater than 0');
  }

  return errors;
}

/**
 * Merge user configuration with defaults
 */
export function mergeWithDefaults(
  userConfig: Partial<MultiProviderConfig>,
): MultiProviderConfig {
  const defaultConfig = createDefaultMultiProviderConfig();

  return {
    providers: {
      ...defaultConfig.providers,
      ...userConfig.providers,
    },
    agents: userConfig.agents || defaultConfig.agents,
    defaultProvider: userConfig.defaultProvider || defaultConfig.defaultProvider,
    activeAgents: userConfig.activeAgents || defaultConfig.activeAgents,
    maxConcurrentSessions: userConfig.maxConcurrentSessions || defaultConfig.maxConcurrentSessions,
    globalSettings: {
      ...defaultConfig.globalSettings,
      ...userConfig.globalSettings,
    },
  };
}

/**
 * Get environment variables for provider configuration
 */
export function getProviderEnvVars(provider: AIProvider): Record<string, string | undefined> {
  switch (provider) {
    case AIProvider.GEMINI:
      return {
        apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
      };

    case AIProvider.CLAUDE:
      return {
        apiKey: process.env.ANTHROPIC_API_KEY,
      };

    case AIProvider.OLLAMA:
      return {
        endpoint: process.env.OLLAMA_HOST || process.env.OLLAMA_ENDPOINT,
      };

    default:
      return {};
  }
}

/**
 * Update provider configuration with environment variables
 */
export function applyEnvironmentVariables(config: ProviderConfig): ProviderConfig {
  const envVars = getProviderEnvVars(config.provider);
  
  return {
    ...config,
    apiKey: config.apiKey || envVars.apiKey,
    endpoint: config.endpoint || envVars.endpoint,
  };
}

/**
 * Create a new agent configuration
 */
export function createAgentConfig(
  agentId: string,
  name: string,
  provider: AIProvider,
  overrides: Partial<ProviderConfig> = {},
): AgentConfig {
  const defaultProviderConfig = DEFAULT_PROVIDER_CONFIGS[provider];
  const providerConfig: ProviderConfig = {
    ...defaultProviderConfig,
    ...overrides,
    provider,
    enabled: true,
  } as ProviderConfig;

  return {
    agentId,
    name,
    provider,
    providerConfig: applyEnvironmentVariables(providerConfig),
    autoStart: false,
    maxSessions: 1,
  };
}