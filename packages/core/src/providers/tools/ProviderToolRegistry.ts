/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool } from '@google/genai';
import { AIProvider, ProviderCapabilities } from '../types.js';

/**
 * Tool configuration for specific providers
 */
interface ProviderToolConfig {
  toolName: string;
  supportedProviders: AIProvider[];
  requiresCapability?: keyof ProviderCapabilities;
  providerSpecificConfig?: Record<AIProvider, any>;
}

/**
 * Registry for managing tools across different providers
 */
export class ProviderToolRegistry {
  private toolConfigs: Map<string, ProviderToolConfig> = new Map();
  private globalTools: Map<string, Tool> = new Map();

  /**
   * Register a tool with provider-specific configuration
   */
  registerTool(
    tool: Tool,
    config: Omit<ProviderToolConfig, 'toolName'>
  ): void {
    const toolName = this.getToolName(tool);
    
    this.globalTools.set(toolName, tool);
    this.toolConfigs.set(toolName, {
      toolName,
      ...config,
    });
  }

  /**
   * Get tools that are compatible with a specific provider
   */
  getToolsForProvider(
    provider: AIProvider,
    capabilities: ProviderCapabilities,
    requestedTools?: string[]
  ): Tool[] {
    const availableTools: Tool[] = [];

    for (const [toolName, config] of this.toolConfigs.entries()) {
      // Check if tool is supported by this provider
      if (!config.supportedProviders.includes(provider)) {
        continue;
      }

      // Check if provider has required capabilities
      if (config.requiresCapability && !capabilities[config.requiresCapability]) {
        continue;
      }

      // If specific tools requested, only include those
      if (requestedTools && !requestedTools.includes(toolName)) {
        continue;
      }

      const tool = this.globalTools.get(toolName);
      if (tool) {
        // Apply provider-specific configuration if available
        const providerConfig = config.providerSpecificConfig?.[provider];
        if (providerConfig) {
          availableTools.push(this.applyProviderConfig(tool, providerConfig));
        } else {
          availableTools.push(tool);
        }
      }
    }

    return availableTools;
  }

  /**
   * Get all registered tools regardless of provider compatibility
   */
  getAllTools(): Tool[] {
    return Array.from(this.globalTools.values());
  }

  /**
   * Get tool configuration for a specific tool
   */
  getToolConfig(toolName: string): ProviderToolConfig | undefined {
    return this.toolConfigs.get(toolName);
  }

  /**
   * Check if a tool is supported by a provider
   */
  isToolSupported(
    toolName: string,
    provider: AIProvider,
    capabilities: ProviderCapabilities
  ): boolean {
    const config = this.toolConfigs.get(toolName);
    if (!config) {
      return false;
    }

    // Check provider support
    if (!config.supportedProviders.includes(provider)) {
      return false;
    }

    // Check capabilities
    if (config.requiresCapability && !capabilities[config.requiresCapability]) {
      return false;
    }

    return true;
  }

  /**
   * Get list of tools that are not supported by a provider
   */
  getUnsupportedTools(
    provider: AIProvider,
    capabilities: ProviderCapabilities,
    requestedTools: string[]
  ): string[] {
    const unsupported: string[] = [];

    for (const toolName of requestedTools) {
      if (!this.isToolSupported(toolName, provider, capabilities)) {
        unsupported.push(toolName);
      }
    }

    return unsupported;
  }

  /**
   * Filter tools based on provider capabilities
   */
  filterToolsForProvider(
    tools: Tool[],
    provider: AIProvider,
    capabilities: ProviderCapabilities
  ): { supported: Tool[]; unsupported: string[] } {
    const supported: Tool[] = [];
    const unsupported: string[] = [];

    for (const tool of tools) {
      const toolName = this.getToolName(tool);
      
      if (this.isToolSupported(toolName, provider, capabilities)) {
        supported.push(tool);
      } else {
        unsupported.push(toolName);
      }
    }

    return { supported, unsupported };
  }

  /**
   * Get tool statistics by provider
   */
  getToolStats(): Record<AIProvider, { total: number; byCapability: Record<string, number> }> {
    const stats: Record<AIProvider, { total: number; byCapability: Record<string, number> }> = {
      [AIProvider.GEMINI]: { total: 0, byCapability: {} },
      [AIProvider.CLAUDE]: { total: 0, byCapability: {} },
      [AIProvider.OLLAMA]: { total: 0, byCapability: {} },
    };

    for (const config of this.toolConfigs.values()) {
      for (const provider of config.supportedProviders) {
        stats[provider].total++;
        
        if (config.requiresCapability) {
          const capability = config.requiresCapability;
          stats[provider].byCapability[capability] = 
            (stats[provider].byCapability[capability] || 0) + 1;
        }
      }
    }

    return stats;
  }

  /**
   * Register default tools with their provider compatibility
   */
  registerDefaultTools(): void {
    // File system tools - supported by all providers
    this.registerDefaultTool('read_file', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);
    this.registerDefaultTool('write_file', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);
    this.registerDefaultTool('list_files', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);
    this.registerDefaultTool('glob_files', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);
    this.registerDefaultTool('grep_files', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);

    // Shell tools - supported by all providers
    this.registerDefaultTool('run_shell_command', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);

    // Web tools - supported by all providers
    this.registerDefaultTool('web_search', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);
    this.registerDefaultTool('web_fetch', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);

    // Memory tools - supported by all providers
    this.registerDefaultTool('save_memory', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);
    this.registerDefaultTool('search_memory', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);

    // Editor tools - supported by all providers
    this.registerDefaultTool('edit_file', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);
    this.registerDefaultTool('diff_files', [AIProvider.GEMINI, AIProvider.CLAUDE, AIProvider.OLLAMA]);

    // MCP tools - primarily supported by Gemini, with limited support for others
    this.registerDefaultTool('mcp_tool', [AIProvider.GEMINI], 'supportsTools');
  }

  /**
   * Helper to register a default tool
   */
  private registerDefaultTool(
    toolName: string,
    supportedProviders: AIProvider[],
    requiresCapability?: keyof ProviderCapabilities
  ): void {
    // Create a mock tool object - in real implementation, this would come from the tool registry
    const tool: Tool = {
      function_declarations: [{
        name: toolName,
        description: `${toolName} tool`,
        parameters: {
          type: 'object',
          properties: {},
        },
      }],
    };

    this.registerTool(tool, {
      supportedProviders,
      requiresCapability,
    });
  }

  /**
   * Extract tool name from tool object
   */
  private getToolName(tool: Tool): string {
    return tool.function_declarations?.[0]?.name || 'unknown_tool';
  }

  /**
   * Apply provider-specific configuration to a tool
   */
  private applyProviderConfig(tool: Tool, config: any): Tool {
    // Deep clone the tool and apply provider-specific modifications
    const modifiedTool = JSON.parse(JSON.stringify(tool));
    
    // Apply any provider-specific changes
    if (config.parameters) {
      modifiedTool.function_declarations[0].parameters = {
        ...modifiedTool.function_declarations[0].parameters,
        ...config.parameters,
      };
    }
    
    if (config.description) {
      modifiedTool.function_declarations[0].description = config.description;
    }

    return modifiedTool;
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.toolConfigs.clear();
    this.globalTools.clear();
  }

  /**
   * Get provider compatibility matrix
   */
  getCompatibilityMatrix(): Record<string, Record<AIProvider, boolean>> {
    const matrix: Record<string, Record<AIProvider, boolean>> = {};

    for (const [toolName, config] of this.toolConfigs.entries()) {
      matrix[toolName] = {
        [AIProvider.GEMINI]: config.supportedProviders.includes(AIProvider.GEMINI),
        [AIProvider.CLAUDE]: config.supportedProviders.includes(AIProvider.CLAUDE),
        [AIProvider.OLLAMA]: config.supportedProviders.includes(AIProvider.OLLAMA),
      };
    }

    return matrix;
  }
}