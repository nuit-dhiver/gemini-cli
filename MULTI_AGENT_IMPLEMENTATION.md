# Provider-Agnostic TUI Agent Runner Implementation

This document describes the complete implementation of the multi-provider, multi-agent system for the Gemini CLI, allowing users to run multiple AI agents (Gemini, Claude, Ollama) concurrently with their own configurations, tools, and settings.

## 🎯 Overview

The implementation transforms the existing Gemini CLI into a provider-agnostic platform that supports:

- **Multiple AI Providers**: Gemini, Claude (Anthropic), and Ollama
- **Concurrent Sessions**: Run multiple agent sessions simultaneously  
- **Provider-Specific Tools**: Tools are filtered based on provider capabilities
- **Unified Interface**: Consistent API across all providers
- **Session Management**: Switch between agents and sessions seamlessly
- **Configuration Management**: Provider-specific settings and credentials

## 🏗 Architecture

### Core Components

#### 1. Provider System (`packages/core/src/providers/`)

**Types and Interfaces** (`types.ts`)
- `AIProvider` enum: Gemini, Claude, Ollama
- `ProviderAuthType` enum: Different authentication methods per provider
- `ProviderConfig`: Provider-specific configuration
- `UnifiedRequest/Response`: Common interface across providers
- `ProviderClient`: Base interface for all provider implementations
- `ProviderSession`: Session management interface
- `AgentConfig`: Agent configuration combining provider and session settings

**Base Classes** (`base/`)
- `BaseProviderClient`: Abstract base with common functionality
- `BaseProviderSession`: Session management implementation
- Retry logic, error handling, token estimation

**Provider Implementations**
- `GeminiProviderClient`: Wraps existing Gemini implementation
- `ClaudeProviderClient`: Anthropic Claude API integration
- `OllamaProviderClient`: Local/remote Ollama integration

**Management Layer** (`manager/`)
- `MultiAgentManager`: Orchestrates multiple agents and sessions
- `ProviderFactory`: Creates provider clients with caching

**Integration Layer** (`integration/`)
- `MultiProviderChat`: Adapter for existing GeminiChat interface
- Seamless fallback to original Gemini implementation

#### 2. Configuration System (`packages/core/src/config/providerConfig.ts`)

**Multi-Provider Configuration**
```typescript
interface MultiProviderConfig {
  providers: Record<AIProvider, ProviderConfig>;
  agents: AgentConfig[];
  defaultProvider: AIProvider;
  activeAgents: string[];
  maxConcurrentSessions: number;
  globalSettings: GlobalSettings;
}
```

**Provider-Specific Defaults**
- Gemini: gemini-2.0-flash-exp, API key auth
- Claude: claude-3-5-sonnet-20241022, API key auth
- Ollama: llama2, local endpoint

**Environment Variable Support**
- `GEMINI_API_KEY`, `GOOGLE_API_KEY`
- `ANTHROPIC_API_KEY`
- `OLLAMA_HOST`, `OLLAMA_ENDPOINT`

#### 3. Tool Management (`packages/core/src/providers/tools/`)

**Provider-Aware Tool Registry**
- Tools are registered with provider compatibility
- Capability requirements (streaming, tools, images)
- Provider-specific configurations

**Tool Manager**
- Filters tools based on provider capabilities
- Validates agent tool configurations
- Provides recommendations per provider

**Default Tool Support Matrix**
```
Tool               | Gemini | Claude | Ollama
-------------------|--------|--------|--------
File System Tools  |   ✅   |   ✅   |   ✅
Shell Commands     |   ✅   |   ✅   |   ✅
Web Search/Fetch   |   ✅   |   ✅   |   ✅
Memory Tools       |   ✅   |   ✅   |   ✅
MCP Tools          |   ✅   |   ❌   |   ❌
Function Calling   |   ✅   |   ✅   |   ❌*
```
*Most Ollama models don't support function calling

#### 4. UI Components (`packages/cli/src/ui/components/`)

**Agent Management UI**
- `AgentSelector`: Visual agent selection interface
- `AgentStatusBar`: Current agent and session information
- `SessionTabs`: Tab-like interface for session switching

**Commands**
- `agentCommand`: Comprehensive agent management
  - `agent list` - Show all configured agents
  - `agent create <name> <provider> [model]` - Create new agent
  - `agent switch <name>` - Switch to agent
  - `agent remove <name>` - Remove agent
  - `agent info <name>` - Show agent details
  - `agent sessions` - List active sessions
  - `agent stats` - Usage statistics

**Hooks**
- `useAgentManager`: React hook for agent management
- Integration with existing UI patterns

## 🚀 Usage Examples

### Basic Usage

```bash
# Create agents for different providers
gemini agent create "Code Helper" gemini gemini-2.0-flash-exp
gemini agent create "Writing Assistant" claude claude-3-5-sonnet-20241022
gemini agent create "Local Model" ollama llama2

# List available agents
gemini agent list

# Switch between agents
gemini agent switch "Code Helper"
# Now chatting with Gemini

gemini agent switch "Writing Assistant"  
# Now chatting with Claude

# View active sessions
gemini agent sessions

# Get usage statistics
gemini agent stats
```

### Environment Configuration

```bash
# Gemini
export GEMINI_API_KEY="your-gemini-key"

# Claude
export ANTHROPIC_API_KEY="your-claude-key"

# Ollama (local)
export OLLAMA_HOST="http://localhost:11434"

# Ollama (remote)
export OLLAMA_HOST="http://remote-ollama:11434"
```

### Configuration File Support

The system supports configuration through `.gemini/settings.json`:

```json
{
  "multiProvider": {
    "providers": {
      "gemini": {
        "enabled": true,
        "model": "gemini-2.0-flash-exp",
        "authType": "gemini-api-key"
      },
      "claude": {
        "enabled": true,
        "model": "claude-3-5-sonnet-20241022",
        "authType": "claude-api-key",
        "endpoint": "https://api.anthropic.com/v1/messages"
      },
      "ollama": {
        "enabled": false,
        "model": "llama2",
        "authType": "ollama-local",
        "endpoint": "http://localhost:11434"
      }
    },
    "maxConcurrentSessions": 5,
    "globalSettings": {
      "enableAutoSwitching": false,
      "enableLoadBalancing": false,
      "enableFallback": true
    }
  }
}
```

## 🔌 Provider-Specific Features

### Gemini
- Full tool support including MCP servers
- Streaming with function calling
- Vision model support
- Vertex AI and OAuth authentication
- 2M+ token context length

### Claude
- Excellent reasoning capabilities
- Vision support
- System prompt support
- 200k token context
- Streaming responses

### Ollama
- Local model execution
- Custom model support
- Some models support vision (llava)
- No function calling (yet)
- Configurable endpoints

## 🧪 Testing

Comprehensive test suite covers:

- **Unit Tests**: Individual provider clients
- **Integration Tests**: Multi-agent manager
- **Tool Tests**: Provider compatibility
- **UI Tests**: Component functionality

Run tests:
```bash
npm test
npm run test:integration
```

## 🔒 Security Considerations

- API keys stored securely in environment variables
- No credentials logged or exposed in UI
- Provider isolation prevents cross-contamination
- Tool execution scoped per agent
- Network requests validated and sanitized

## 📊 Performance

- **Concurrent Sessions**: Up to configurable limit (default: 5)
- **Provider Caching**: Client instances cached for reuse  
- **Token Estimation**: Fast local estimation with API fallback
- **Memory Management**: Automatic history trimming
- **Connection Pooling**: Reused HTTP connections where possible

## 🚀 Future Enhancements

### Planned Features
1. **Load Balancing**: Distribute requests across providers
2. **Auto-Switching**: Switch providers based on request type
3. **Cost Tracking**: Monitor usage and costs per provider
4. **Model Comparison**: Side-by-side responses
5. **Custom Providers**: Plugin system for new providers

### Provider Roadmap
- **OpenAI GPT**: Full GPT-4 integration
- **Cohere**: Command and embedding models  
- **Hugging Face**: Inference API support
- **Azure OpenAI**: Enterprise integration
- **AWS Bedrock**: Multi-model access

## 🤝 Contributing

The multi-provider system is designed for extensibility:

1. **New Providers**: Implement `ProviderClient` interface
2. **Custom Tools**: Register with `ProviderToolRegistry`
3. **UI Components**: Follow existing React patterns
4. **Authentication**: Add new auth types as needed

## 📖 Documentation

- Full API documentation in TypeScript interfaces
- Component documentation with usage examples  
- Configuration reference with all options
- Troubleshooting guide for common issues

---

This implementation provides a solid foundation for multi-provider AI agent management while maintaining backward compatibility with the existing Gemini CLI functionality. The modular architecture allows for easy extension and customization based on user needs.