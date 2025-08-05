/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { AIProvider, AgentConfig } from '@google/gemini-cli-core';

interface AgentStatusBarProps {
  activeAgent: AgentConfig | null;
  sessionId: string | null;
  totalSessions: number;
  providerStats: Record<AIProvider, number>;
}

/**
 * Status bar showing current agent and session information
 */
export const AgentStatusBar: React.FC<AgentStatusBarProps> = ({
  activeAgent,
  sessionId,
  totalSessions,
  providerStats,
}) => {
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

  const getStatusColor = (provider: AIProvider) => {
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

  if (!activeAgent) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.DimColor}
        paddingX={1}
        marginBottom={1}
      >
        <Text color={Colors.DimColor}>
          No active agent - use /agent &lt;name&gt; to start a session
        </Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={getStatusColor(activeAgent.provider)}
      paddingX={1}
      marginBottom={1}
    >
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        {/* Left side: Active agent info */}
        <Box flexDirection="row" alignItems="center">
          <Text color={getStatusColor(activeAgent.provider)}>
            {getProviderIcon(activeAgent.provider)} {activeAgent.name}
          </Text>
          <Text color={Colors.DimColor} dimColor>
            {' '}({activeAgent.providerConfig.model})
          </Text>
          {sessionId && (
            <Text color={Colors.DimColor} dimColor>
              {' '}• Session: {sessionId.split('-').pop()}
            </Text>
          )}
        </Box>

        {/* Right side: Session statistics */}
        <Box flexDirection="row" alignItems="center">
          <Text color={Colors.DimColor} dimColor>
            Sessions: {totalSessions}
          </Text>
          {Object.entries(providerStats).map(([provider, count]) => {
            if (count === 0) return null;
            return (
              <Text key={provider} color={Colors.DimColor} dimColor>
                {' '}• {getProviderIcon(provider as AIProvider)}{count}
              </Text>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};