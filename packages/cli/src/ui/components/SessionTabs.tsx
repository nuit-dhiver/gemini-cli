/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { AIProvider, ProviderSession } from '@google/gemini-cli-core';

interface SessionTabsProps {
  sessions: ProviderSession[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  visible: boolean;
}

/**
 * Tab-like interface for switching between active sessions
 */
export const SessionTabs: React.FC<SessionTabsProps> = ({
  sessions,
  activeSessionId,
  onSessionSelect,
  visible,
}) => {
  if (!visible || sessions.length <= 1) {
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

  const getTabName = (session: ProviderSession): string => {
    const shortId = session.sessionId.split('-').pop() || 'unknown';
    return `${getProviderIcon(session.provider)} ${shortId}`;
  };

  const getTabColor = (session: ProviderSession, isActive: boolean) => {
    if (isActive) {
      return Colors.HighlightColor;
    }
    
    switch (session.provider) {
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
      <Box flexDirection="row" flexWrap="wrap">
        {sessions.map((session, index) => {
          const isActive = session.sessionId === activeSessionId;
          const tabColor = getTabColor(session, isActive);
          
          return (
            <Box
              key={session.sessionId}
              borderStyle={isActive ? 'double' : 'single'}
              borderColor={isActive ? Colors.HighlightColor : Colors.DimColor}
              paddingX={1}
              marginRight={1}
              marginBottom={1}
            >
              <Text color={tabColor}>
                {getTabName(session)}
              </Text>
              {isActive && (
                <Text color={Colors.HighlightColor}>
                  {' '}●
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      
      {sessions.length > 3 && (
        <Box marginTop={1}>
          <Text color={Colors.DimColor} dimColor>
            Use /session &lt;id&gt; to switch sessions, or Ctrl+Tab to cycle
          </Text>
        </Box>
      )}
    </Box>
  );
};