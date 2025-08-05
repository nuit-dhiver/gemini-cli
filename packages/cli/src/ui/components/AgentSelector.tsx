/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { AIProvider, AgentConfig } from '@google/gemini-cli-core';

interface AgentSelectorProps {
  agents: AgentConfig[];
  activeAgentId: string | null;
  onAgentSelect: (agentId: string) => void;
  visible: boolean;
}

/**
 * Component for selecting between different AI agents
 */
export const AgentSelector: React.FC<AgentSelectorProps> = ({
  agents,
  activeAgentId,
  onAgentSelect,
  visible,
}) => {
  if (!visible || agents.length === 0) {
    return null;
  }

  const getProviderIcon = (provider: AIProvider): string => {
    switch (provider) {
      case AIProvider.GEMINI:
        return '✨';
      case AIProvider.CLAUDE:
        return '🤖';
      case AIProvider.OLLAMA:
        return '🦙';
      default:
        return '🔮';
    }
  };

  const getProviderColor = (provider: AIProvider, isActive: boolean) => {
    if (isActive) {
      return Colors.HighlightColor;
    }
    
    switch (provider) {
      case AIProvider.GEMINI:
        return Colors.AccentColor;
      case AIProvider.CLAUDE:
        return Colors.InfoColor;
      case AIProvider.OLLAMA:
        return Colors.WarningColor;
      default:
        return Colors.TextColor;
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text color={Colors.AccentColor} bold>
          Available Agents:
        </Text>
      </Box>
      
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {agents.map((agent, index) => {
          const isActive = agent.agentId === activeAgentId;
          const providerColor = getProviderColor(agent.provider, isActive);
          
          return (
            <Box
              key={agent.agentId}
              borderStyle="round"
              borderColor={isActive ? Colors.HighlightColor : Colors.DimColor}
              paddingX={1}
              marginRight={1}
              marginBottom={1}
            >
              <Text color={providerColor}>
                {getProviderIcon(agent.provider)} {agent.name}
              </Text>
              {isActive && (
                <Text color={Colors.HighlightColor} bold>
                  {' '}← ACTIVE
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      
      <Box marginTop={1}>
        <Text color={Colors.DimColor} dimColor>
          Use /agent &lt;name&gt; to switch agents, or /agents to manage
        </Text>
      </Box>
    </Box>
  );
};