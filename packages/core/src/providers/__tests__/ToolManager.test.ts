/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolManager } from '../tools/ToolManager.js';
import { ProviderToolRegistry } from '../tools/ProviderToolRegistry.js';
import { AIProvider, AgentConfig, ProviderAuthType } from '../types.js';
import { Tool } from '@google/genai';

describe('ToolManager', () => {
  let toolManager: ToolManager;

  beforeEach(() => {
    toolManager = new ToolManager();
  });

  describe('initialization', () => {
    it('should initialize with default tools registered', () => {
      const registry = toolManager.getRegistry();
      const allTools = registry.getAllTools();
      
      expect(allTools.length).toBeGreaterThan(0);
    });

    it('should have tool compatibility matrix', () => {
      const registry = toolManager.getRegistry();
      const matrix = registry.getCompatibilityMatrix();
      
      expect(matrix).toHaveProperty('read_file');
      expect(matrix['read_file']).toHaveProperty(AIProvider.GEMINI);
      expect(matrix['read_file']).toHaveProperty(AIProvider.CLAUDE);
      expect(matrix['read_file']).toHaveProperty(AIProvider.OLLAMA);
    });
  });

  describe('agent tool management', () => {
    it('should set and get agent tools', () => {
      const agentId = 'test-agent';
      const toolNames = ['read_file', 'write_file', 'run_shell_command'];

      toolManager.setAgentTools(agentId, toolNames);

      const geminiCapabilities = {
        supportsStreaming: true,
        supportsTools: true,
        supportsImages: true,
        supportsSystemPrompts: true,
        maxContextLength: 2097152,
        supportedModels: ['gemini-2.0-flash-exp'],
      };

      const { tools, unsupported } = toolManager.getAgentTools(
        agentId,
        AIProvider.GEMINI,
        geminiCapabilities
      );

      expect(tools.length).toBeGreaterThan(0);
      expect(unsupported).toHaveLength(0);
    });

    it('should return all compatible tools when no specific tools requested', () => {
      const agentId = 'all-tools-agent';

      const geminiCapabilities = {
        supportsStreaming: true,
        supportsTools: true,
        supportsImages: true,
        supportsSystemPrompts: true,
        maxContextLength: 2097152,
        supportedModels: ['gemini-2.0-flash-exp'],
      };

      const { tools, unsupported } = toolManager.getAgentTools(
        agentId,
        AIProvider.GEMINI,
        geminiCapabilities
      );

      expect(tools.length).toBeGreaterThan(5); // Should have many default tools
      expect(unsupported).toHaveLength(0);
    });

    it('should identify unsupported tools for Ollama', () => {
      const agentId = 'ollama-agent';
      const toolNames = ['read_file', 'mcp_tool']; // mcp_tool requires supportsTools

      toolManager.setAgentTools(agentId, toolNames);

      const ollamaCapabilities = {
        supportsStreaming: true,
        supportsTools: false, // Ollama doesn't support tools
        supportsImages: false,
        supportsSystemPrompts: true,
        maxContextLength: 8192,
        supportedModels: ['llama2'],
      };

      const { tools, unsupported } = toolManager.getAgentTools(
        agentId,
        AIProvider.OLLAMA,
        ollamaCapabilities
      );

      expect(tools.length).toBe(1); // Only read_file should be supported
      expect(unsupported).toContain('mcp_tool');
    });
  });

  describe('agent configuration validation', () => {
    it('should validate agent tools successfully', () => {
      const readFileTool: Tool = {
        function_declarations: [{
          name: 'read_file',
          description: 'Read file contents',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
          },
        }],
      };

      const agentConfig: AgentConfig = {
        agentId: 'valid-agent',
        name: 'Valid Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
        tools: [readFileTool],
      };

      const validation = toolManager.validateAgentTools(agentConfig);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should return warnings for unsupported tools', () => {
      const mcpTool: Tool = {
        function_declarations: [{
          name: 'mcp_tool',
          description: 'MCP tool',
          parameters: {
            type: 'object',
            properties: {},
          },
        }],
      };

      const agentConfig: AgentConfig = {
        agentId: 'ollama-agent',
        name: 'Ollama Agent',
        provider: AIProvider.OLLAMA,
        providerConfig: {
          provider: AIProvider.OLLAMA,
          model: 'llama2',
          authType: ProviderAuthType.OLLAMA_LOCAL,
          enabled: true,
        },
        tools: [mcpTool],
      };

      const validation = toolManager.validateAgentTools(agentConfig);

      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings[0]).toContain('mcp_tool');
    });

    it('should validate agent with no tools', () => {
      const agentConfig: AgentConfig = {
        agentId: 'no-tools-agent',
        name: 'No Tools Agent',
        provider: AIProvider.GEMINI,
        providerConfig: {
          provider: AIProvider.GEMINI,
          model: 'gemini-2.0-flash-exp',
          authType: ProviderAuthType.GEMINI_API_KEY,
          enabled: true,
        },
      };

      const validation = toolManager.validateAgentTools(agentConfig);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });
  });

  describe('recommended tools', () => {
    it('should return all tools for general use case', () => {
      const geminiCapabilities = {
        supportsStreaming: true,
        supportsTools: true,
        supportsImages: true,
        supportsSystemPrompts: true,
        maxContextLength: 2097152,
        supportedModels: ['gemini-2.0-flash-exp'],
      };

      const generalTools = toolManager.getRecommendedTools(
        AIProvider.GEMINI,
        geminiCapabilities,
        'general'
      );

      const allTools = toolManager.getRecommendedTools(
        AIProvider.GEMINI,
        geminiCapabilities
      );

      expect(generalTools).toEqual(allTools);
    });

    it('should filter tools for development use case', () => {
      const geminiCapabilities = {
        supportsStreaming: true,
        supportsTools: true,
        supportsImages: true,
        supportsSystemPrompts: true,
        maxContextLength: 2097152,
        supportedModels: ['gemini-2.0-flash-exp'],
      };

      const devTools = toolManager.getRecommendedTools(
        AIProvider.GEMINI,
        geminiCapabilities,
        'development'
      );

      const allTools = toolManager.getRecommendedTools(
        AIProvider.GEMINI,
        geminiCapabilities
      );

      expect(devTools.length).toBeLessThanOrEqual(allTools.length);
      
      // Should include common development tools
      const toolNames = devTools.map(tool => 
        tool.function_declarations?.[0]?.name
      );
      
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('run_shell_command');
    });

    it('should filter tools for research use case', () => {
      const geminiCapabilities = {
        supportsStreaming: true,
        supportsTools: true,
        supportsImages: true,
        supportsSystemPrompts: true,
        maxContextLength: 2097152,
        supportedModels: ['gemini-2.0-flash-exp'],
      };

      const researchTools = toolManager.getRecommendedTools(
        AIProvider.GEMINI,
        geminiCapabilities,
        'research'
      );

      const toolNames = researchTools.map(tool => 
        tool.function_declarations?.[0]?.name
      );

      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('save_memory');
    });
  });

  describe('custom tools', () => {
    it('should register custom tool', () => {
      const customTool: Tool = {
        function_declarations: [{
          name: 'custom_tool',
          description: 'Custom tool for testing',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
          },
        }],
      };

      toolManager.registerCustomTool(
        customTool,
        [AIProvider.GEMINI, AIProvider.CLAUDE],
        'supportsTools'
      );

      const registry = toolManager.getRegistry();
      const config = registry.getToolConfig('custom_tool');

      expect(config).toBeDefined();
      expect(config?.supportedProviders).toContain(AIProvider.GEMINI);
      expect(config?.supportedProviders).toContain(AIProvider.CLAUDE);
      expect(config?.supportedProviders).not.toContain(AIProvider.OLLAMA);
      expect(config?.requiresCapability).toBe('supportsTools');
    });
  });

  describe('compatibility report', () => {
    it('should generate comprehensive compatibility report', () => {
      const report = toolManager.generateCompatibilityReport();

      expect(report).toHaveProperty('matrix');
      expect(report).toHaveProperty('stats');
      expect(report).toHaveProperty('recommendations');

      // Check stats structure
      expect(report.stats).toHaveProperty(AIProvider.GEMINI);
      expect(report.stats).toHaveProperty(AIProvider.CLAUDE);
      expect(report.stats).toHaveProperty(AIProvider.OLLAMA);

      expect(report.stats[AIProvider.GEMINI].total).toBeGreaterThan(0);

      // Check recommendations
      expect(report.recommendations[AIProvider.GEMINI]).toBeInstanceOf(Array);
      expect(report.recommendations[AIProvider.CLAUDE]).toBeInstanceOf(Array);
      expect(report.recommendations[AIProvider.OLLAMA]).toBeInstanceOf(Array);
    });
  });

  describe('tool mappings management', () => {
    it('should manage agent tool mappings', () => {
      const agentId = 'mapping-test-agent';
      const toolNames = ['read_file', 'write_file'];

      toolManager.setAgentTools(agentId, toolNames);

      const mappings = toolManager.getAllAgentToolMappings();
      expect(mappings[agentId]).toEqual(toolNames);

      toolManager.removeAgentTools(agentId);

      const updatedMappings = toolManager.getAllAgentToolMappings();
      expect(updatedMappings[agentId]).toBeUndefined();
    });
  });
});