/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { 
  AIProvider, 
  AgentConfig, 
  ProviderSession,
  AgentManager,
  createAgentConfig,
  PROVIDER_MODELS,
} from '@google/gemini-cli-core';
import type { CommandFunction } from './types.js';

/**
 * Agent command for managing AI agents
 */
export const agentCommand: CommandFunction = ({
  args,
  config,
  agentManager,
  onAgentSwitch,
}) => {
  const [subCommand, ...subArgs] = args;

  if (!agentManager) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Agent manager not available
        </Text>
      ),
    };
  }

  switch (subCommand) {
    case 'list':
    case 'ls':
      return handleListAgents(agentManager);
    
    case 'create':
    case 'new':
      return handleCreateAgent(subArgs, agentManager);
    
    case 'switch':
    case 'use':
      return handleSwitchAgent(subArgs, agentManager, onAgentSwitch);
    
    case 'remove':
    case 'delete':
    case 'rm':
      return handleRemoveAgent(subArgs, agentManager);
    
    case 'info':
      return handleAgentInfo(subArgs, agentManager);
    
    case 'sessions':
      return handleListSessions(agentManager);
    
    case 'stats':
      return handleAgentStats(agentManager);
    
    default:
      return handleAgentHelp();
  }
};

async function handleListAgents(agentManager: AgentManager) {
  try {
    const agents = await agentManager.listAgents();
    
    if (agents.length === 0) {
      return {
        output: (
          <Text color={Colors.InfoColor}>
            No agents configured. Use 'agent create' to create one.
          </Text>
        ),
      };
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

    return {
      output: (
        <Box flexDirection="column">
          <Text color={Colors.AccentColor} bold>
            Configured Agents:
          </Text>
          {agents.map((agent) => (
            <Box key={agent.agentId} marginLeft={2} marginY={1}>
              <Text color={Colors.TextColor}>
                {getProviderIcon(agent.provider)} <Text bold>{agent.name}</Text>
              </Text>
              <Text color={Colors.DimColor}>
                {' '}({agent.agentId}) - {agent.provider}:{agent.providerConfig.model}
              </Text>
            </Box>
          ))}
        </Box>
      ),
    };
  } catch (error) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Error listing agents: {error instanceof Error ? error.message : String(error)}
        </Text>
      ),
    };
  }
}

async function handleCreateAgent(
  args: string[], 
  agentManager: AgentManager
) {
  const [name, provider, model] = args;

  if (!name || !provider) {
    return {
      output: (
        <Box flexDirection="column">
          <Text color={Colors.ErrorColor}>
            Usage: agent create &lt;name&gt; &lt;provider&gt; [model]
          </Text>
          <Text color={Colors.DimColor}>
            Providers: gemini, claude, ollama
          </Text>
        </Box>
      ),
    };
  }

  const providerEnum = provider as AIProvider;
  if (!Object.values(AIProvider).includes(providerEnum)) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Invalid provider: {provider}. Use: gemini, claude, or ollama
        </Text>
      ),
    };
  }

  try {
    // Get available models for the provider
    const availableModels = PROVIDER_MODELS[providerEnum];
    const selectedModel = model || availableModels[0];

    if (!availableModels.includes(selectedModel)) {
      return {
        output: (
          <Box flexDirection="column">
            <Text color={Colors.ErrorColor}>
              Invalid model: {selectedModel}
            </Text>
            <Text color={Colors.DimColor}>
              Available models for {provider}: {availableModels.join(', ')}
            </Text>
          </Box>
        ),
      };
    }

    const agentId = `${provider}-${name.toLowerCase().replace(/\s+/g, '-')}`;
    const agentConfig = createAgentConfig(agentId, name, providerEnum, {
      model: selectedModel,
    });

    await agentManager.createAgent(agentConfig);

    return {
      output: (
        <Text color={Colors.SuccessColor}>
          Agent '{name}' created successfully with {provider}:{selectedModel}
        </Text>
      ),
    };
  } catch (error) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Error creating agent: {error instanceof Error ? error.message : String(error)}
        </Text>
      ),
    };
  }
}

async function handleSwitchAgent(
  args: string[], 
  agentManager: AgentManager,
  onAgentSwitch?: (sessionId: string) => void
) {
  const [agentName] = args;

  if (!agentName) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Usage: agent switch &lt;agent-name&gt;
        </Text>
      ),
    };
  }

  try {
    const agents = await agentManager.listAgents();
    const agent = agents.find(
      (a) => a.name.toLowerCase() === agentName.toLowerCase() || 
             a.agentId.toLowerCase() === agentName.toLowerCase()
    );

    if (!agent) {
      return {
        output: (
          <Text color={Colors.ErrorColor}>
            Agent '{agentName}' not found
          </Text>
        ),
      };
    }

    // Check if agent already has an active session
    const existingSession = await agentManager.getAgent(agent.agentId);
    let sessionId: string;

    if (existingSession) {
      sessionId = existingSession.sessionId;
    } else {
      // Start a new session
      sessionId = await agentManager.startSession(agent.agentId);
    }

    await agentManager.switchToSession(sessionId);

    if (onAgentSwitch) {
      onAgentSwitch(sessionId);
    }

    return {
      output: (
        <Text color={Colors.SuccessColor}>
          Switched to agent '{agent.name}' (session: {sessionId.split('-').pop()})
        </Text>
      ),
    };
  } catch (error) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Error switching agent: {error instanceof Error ? error.message : String(error)}
        </Text>
      ),
    };
  }
}

async function handleRemoveAgent(args: string[], agentManager: AgentManager) {
  const [agentName] = args;

  if (!agentName) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Usage: agent remove &lt;agent-name&gt;
        </Text>
      ),
    };
  }

  try {
    const agents = await agentManager.listAgents();
    const agent = agents.find(
      (a) => a.name.toLowerCase() === agentName.toLowerCase() || 
             a.agentId.toLowerCase() === agentName.toLowerCase()
    );

    if (!agent) {
      return {
        output: (
          <Text color={Colors.ErrorColor}>
            Agent '{agentName}' not found
          </Text>
        ),
      };
    }

    await agentManager.removeAgent(agent.agentId);

    return {
      output: (
        <Text color={Colors.SuccessColor}>
          Agent '{agent.name}' removed successfully
        </Text>
      ),
    };
  } catch (error) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Error removing agent: {error instanceof Error ? error.message : String(error)}
        </Text>
      ),
    };
  }
}

async function handleAgentInfo(args: string[], agentManager: AgentManager) {
  const [agentName] = args;

  if (!agentName) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Usage: agent info &lt;agent-name&gt;
        </Text>
      ),
    };
  }

  try {
    const agents = await agentManager.listAgents();
    const agent = agents.find(
      (a) => a.name.toLowerCase() === agentName.toLowerCase() || 
             a.agentId.toLowerCase() === agentName.toLowerCase()
    );

    if (!agent) {
      return {
        output: (
          <Text color={Colors.ErrorColor}>
            Agent '{agentName}' not found
          </Text>
        ),
      };
    }

    return {
      output: (
        <Box flexDirection="column">
          <Text color={Colors.AccentColor} bold>
            Agent Information:
          </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text color={Colors.TextColor}>
              <Text bold>Name:</Text> {agent.name}
            </Text>
            <Text color={Colors.TextColor}>
              <Text bold>ID:</Text> {agent.agentId}
            </Text>
            <Text color={Colors.TextColor}>
              <Text bold>Provider:</Text> {agent.provider}
            </Text>
            <Text color={Colors.TextColor}>
              <Text bold>Model:</Text> {agent.providerConfig.model}
            </Text>
            <Text color={Colors.TextColor}>
              <Text bold>Auth Type:</Text> {agent.providerConfig.authType}
            </Text>
            {agent.providerConfig.endpoint && (
              <Text color={Colors.TextColor}>
                <Text bold>Endpoint:</Text> {agent.providerConfig.endpoint}
              </Text>
            )}
            <Text color={Colors.TextColor}>
              <Text bold>Auto Start:</Text> {agent.autoStart ? 'Yes' : 'No'}
            </Text>
            <Text color={Colors.TextColor}>
              <Text bold>Max Sessions:</Text> {agent.maxSessions || 'Unlimited'}
            </Text>
            {agent.tools && agent.tools.length > 0 && (
              <Text color={Colors.TextColor}>
                <Text bold>Tools:</Text> {agent.tools.length} configured
              </Text>
            )}
          </Box>
        </Box>
      ),
    };
  } catch (error) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Error getting agent info: {error instanceof Error ? error.message : String(error)}
        </Text>
      ),
    };
  }
}

async function handleListSessions(agentManager: AgentManager) {
  try {
    const sessions = await agentManager.getActiveSessions();

    if (sessions.length === 0) {
      return {
        output: (
          <Text color={Colors.InfoColor}>
            No active sessions
          </Text>
        ),
      };
    }

    return {
      output: (
        <Box flexDirection="column">
          <Text color={Colors.AccentColor} bold>
            Active Sessions:
          </Text>
          {sessions.map((session) => (
            <Box key={session.sessionId} marginLeft={2} marginY={1}>
              <Text color={Colors.TextColor}>
                <Text bold>{session.sessionId.split('-').pop()}</Text>
              </Text>
              <Text color={Colors.DimColor}>
                {' '}({session.provider}) - {session.history.length} messages
              </Text>
            </Box>
          ))}
        </Box>
      ),
    };
  } catch (error) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Error listing sessions: {error instanceof Error ? error.message : String(error)}
        </Text>
      ),
    };
  }
}

async function handleAgentStats(agentManager: AgentManager) {
  try {
    const stats = (agentManager as any).getStats?.();

    if (!stats) {
      return {
        output: (
          <Text color={Colors.ErrorColor}>
            Stats not available
          </Text>
        ),
      };
    }

    return {
      output: (
        <Box flexDirection="column">
          <Text color={Colors.AccentColor} bold>
            Agent Statistics:
          </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text color={Colors.TextColor}>
              <Text bold>Total Agents:</Text> {stats.totalAgents}
            </Text>
            <Text color={Colors.TextColor}>
              <Text bold>Active Agents:</Text> {stats.activeAgents}
            </Text>
            <Text color={Colors.TextColor}>
              <Text bold>Total Sessions:</Text> {stats.totalSessions}
            </Text>
            <Text color={Colors.AccentColor} bold>
              Sessions by Provider:
            </Text>
            {Object.entries(stats.sessionsByProvider).map(([provider, count]) => (
              <Text key={provider} color={Colors.TextColor} marginLeft={2}>
                {provider}: {count}
              </Text>
            ))}
          </Box>
        </Box>
      ),
    };
  } catch (error) {
    return {
      output: (
        <Text color={Colors.ErrorColor}>
          Error getting stats: {error instanceof Error ? error.message : String(error)}
        </Text>
      ),
    };
  }
}

function handleAgentHelp() {
  return {
    output: (
      <Box flexDirection="column">
        <Text color={Colors.AccentColor} bold>
          Agent Commands:
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text color={Colors.TextColor}>
            <Text bold>agent list</Text> - List all configured agents
          </Text>
          <Text color={Colors.TextColor}>
            <Text bold>agent create &lt;name&gt; &lt;provider&gt; [model]</Text> - Create a new agent
          </Text>
          <Text color={Colors.TextColor}>
            <Text bold>agent switch &lt;name&gt;</Text> - Switch to an agent
          </Text>
          <Text color={Colors.TextColor}>
            <Text bold>agent remove &lt;name&gt;</Text> - Remove an agent
          </Text>
          <Text color={Colors.TextColor}>
            <Text bold>agent info &lt;name&gt;</Text> - Show agent details
          </Text>
          <Text color={Colors.TextColor}>
            <Text bold>agent sessions</Text> - List active sessions
          </Text>
          <Text color={Colors.TextColor}>
            <Text bold>agent stats</Text> - Show usage statistics
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.DimColor}>
            Providers: gemini, claude, ollama
          </Text>
        </Box>
      </Box>
    ),
  };
}