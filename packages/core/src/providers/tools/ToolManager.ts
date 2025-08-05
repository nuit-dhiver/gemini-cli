/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool } from '@google/genai';
import { AIProvider, ProviderCapabilities, AgentConfig } from '../types.js';
import { ProviderToolRegistry } from './ProviderToolRegistry.js';

/**
 * Tool manager that handles tool assignment and filtering for different providers
 */
export class ToolManager {
  private toolRegistry: ProviderToolRegistry;
  private agentToolMappings: Map<string, string[]> = new Map();

  constructor() {
    this.toolRegistry = new ProviderToolRegistry();
    this.toolRegistry.registerDefaultTools();
  }

  /**
   * Get the global tool registry
   */
  getRegistry(): ProviderToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Set tools for a specific agent
   */
  setAgentTools(agentId: string, toolNames: string[]): void {
    this.agentToolMappings.set(agentId, toolNames);
  }

  /**
   * Get tools for a specific agent, filtered by provider capabilities
   */
  getAgentTools(
    agentId: string,
    provider: AIProvider,
    capabilities: ProviderCapabilities
  ): { tools: Tool[]; unsupported: string[] } {
    const requestedTools = this.agentToolMappings.get(agentId) || [];
    
    if (requestedTools.length === 0) {
      // If no specific tools requested, return all compatible tools
      return {
        tools: this.toolRegistry.getToolsForProvider(provider, capabilities),
        unsupported: [],
      };
    }

    const tools = this.toolRegistry.getToolsForProvider(
      provider,
      capabilities,
      requestedTools
    );

    const unsupported = this.toolRegistry.getUnsupportedTools(
      provider,
      capabilities,
      requestedTools
    );

    return { tools, unsupported };
  }

  /**
   * Get tools from agent configuration, with provider filtering
   */
  getToolsFromAgentConfig(
    agentConfig: AgentConfig,
    capabilities: ProviderCapabilities
  ): { tools: Tool[]; unsupported: string[] } {
    if (!agentConfig.tools || agentConfig.tools.length === 0) {
      // Return all compatible tools if none specified
      return {
        tools: this.toolRegistry.getToolsForProvider(agentConfig.provider, capabilities),
        unsupported: [],
      };
    }

    // Filter provided tools based on provider capabilities
    const { supported, unsupported } = this.toolRegistry.filterToolsForProvider(
      agentConfig.tools,
      agentConfig.provider,
      capabilities
    );

    return {
      tools: supported,
      unsupported,
    };
  }

  /**
   * Validate tool compatibility for an agent configuration
   */
  validateAgentTools(agentConfig: AgentConfig): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!agentConfig.tools || agentConfig.tools.length === 0) {
      return { valid: true, errors, warnings };
    }

    // Get provider capabilities (this would normally come from the provider client)
    const capabilities = this.getProviderCapabilities(agentConfig.provider);

    for (const tool of agentConfig.tools) {
      const toolName = this.getToolName(tool);
      
      if (!this.toolRegistry.isToolSupported(toolName, agentConfig.provider, capabilities)) {
        const config = this.toolRegistry.getToolConfig(toolName);
        
        if (config) {
          if (!config.supportedProviders.includes(agentConfig.provider)) {
            warnings.push(
              `Tool '${toolName}' is not supported by provider '${agentConfig.provider}'. ` +
              `Supported providers: ${config.supportedProviders.join(', ')}`
            );
          } else if (config.requiresCapability && !capabilities[config.requiresCapability]) {
            errors.push(
              `Tool '${toolName}' requires capability '${config.requiresCapability}' ` +
              `which is not available in provider '${agentConfig.provider}'`
            );
          }
        } else {
          warnings.push(`Unknown tool '${toolName}'`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get recommended tools for a provider
   */
  getRecommendedTools(
    provider: AIProvider,
    capabilities: ProviderCapabilities,
    useCase?: 'development' | 'research' | 'general'
  ): Tool[] {
    const allTools = this.toolRegistry.getToolsForProvider(provider, capabilities);
    
    if (!useCase || useCase === 'general') {
      return allTools;
    }

    // Filter tools based on use case
    const toolNames = allTools.map(tool => this.getToolName(tool));
    const filteredNames = this.filterToolsByUseCase(toolNames, useCase);
    
    return allTools.filter(tool => 
      filteredNames.includes(this.getToolName(tool))
    );
  }

  /**
   * Generate tool compatibility report for all providers
   */
  generateCompatibilityReport(): {
    matrix: Record<string, Record<AIProvider, boolean>>;
    stats: Record<AIProvider, { total: number; byCapability: Record<string, number> }>;
    recommendations: Record<AIProvider, string[]>;
  } {
    const matrix = this.toolRegistry.getCompatibilityMatrix();
    const stats = this.toolRegistry.getToolStats();
    
    const recommendations: Record<AIProvider, string[]> = {
      [AIProvider.GEMINI]: this.getProviderRecommendations(AIProvider.GEMINI),
      [AIProvider.CLAUDE]: this.getProviderRecommendations(AIProvider.CLAUDE),
      [AIProvider.OLLAMA]: this.getProviderRecommendations(AIProvider.OLLAMA),
    };

    return {
      matrix,
      stats,
      recommendations,
    };
  }

  /**
   * Update tool registry with custom tools
   */
  registerCustomTool(
    tool: Tool,
    supportedProviders: AIProvider[],
    requiresCapability?: keyof ProviderCapabilities,
    providerSpecificConfig?: Record<AIProvider, any>
  ): void {
    this.toolRegistry.registerTool(tool, {
      supportedProviders,
      requiresCapability,
      providerSpecificConfig,
    });
  }

  /**
   * Remove tools for an agent
   */
  removeAgentTools(agentId: string): void {
    this.agentToolMappings.delete(agentId);
  }

  /**
   * Get all agents and their tool assignments
   */
  getAllAgentToolMappings(): Record<string, string[]> {
    return Object.fromEntries(this.agentToolMappings.entries());
  }

  /**
   * Helper to get provider capabilities
   */
  private getProviderCapabilities(provider: AIProvider): ProviderCapabilities {
    // This would normally be retrieved from the provider client
    // For now, return hardcoded capabilities
    switch (provider) {
      case AIProvider.GEMINI:
        return {
          supportsStreaming: true,
          supportsTools: true,
          supportsImages: true,
          supportsSystemPrompts: true,
          maxContextLength: 2097152,
          supportedModels: ['gemini-2.0-flash-exp', 'gemini-1.5-pro'],
        };
      case AIProvider.CLAUDE:
        return {
          supportsStreaming: true,
          supportsTools: true,
          supportsImages: true,
          supportsSystemPrompts: true,
          maxContextLength: 200000,
          supportedModels: ['claude-3-5-sonnet-20241022'],
        };
      case AIProvider.OLLAMA:
        return {
          supportsStreaming: true,
          supportsTools: false,
          supportsImages: false,
          supportsSystemPrompts: true,
          maxContextLength: 8192,
          supportedModels: ['llama2', 'mistral'],
        };
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Helper to extract tool name from tool object
   */
  private getToolName(tool: Tool): string {
    return tool.function_declarations?.[0]?.name || 'unknown_tool';
  }

  /**
   * Filter tools by use case
   */
  private filterToolsByUseCase(toolNames: string[], useCase: string): string[] {
    const useCaseTools: Record<string, string[]> = {
      development: [
        'read_file',
        'write_file',
        'edit_file',
        'run_shell_command',
        'diff_files',
        'grep_files',
        'glob_files',
      ],
      research: [
        'web_search',
        'web_fetch',
        'read_file',
        'save_memory',
        'search_memory',
      ],
    };

    const relevantTools = useCaseTools[useCase] || toolNames;
    return toolNames.filter(name => relevantTools.includes(name));
  }

  /**
   * Get provider-specific recommendations
   */
  private getProviderRecommendations(provider: AIProvider): string[] {
    const recommendations: Record<AIProvider, string[]> = {
      [AIProvider.GEMINI]: [
        'Use all available tools as Gemini has excellent tool support',
        'Consider enabling MCP tools for extended functionality',
        'Image processing tools work well with vision models',
      ],
      [AIProvider.CLAUDE]: [
        'Focus on text-based tools as Claude excels in reasoning',
        'Use file system tools for code analysis tasks',
        'Web search tools complement Claude\'s knowledge',
      ],
      [AIProvider.OLLAMA]: [
        'Limit to basic tools as most local models don\'t support function calling',
        'Focus on file reading and shell command tools',
        'Consider tool output summarization for smaller context windows',
      ],
    };

    return recommendations[provider] || [];
  }
}