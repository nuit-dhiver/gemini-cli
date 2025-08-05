# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development Workflow
- **Build**: `npm run build` - Builds all packages (TypeScript compilation and bundling)
- **Start/Run**: `npm start` - Starts the Gemini CLI from source
- **Debug**: `npm run debug` - Starts CLI in debug mode with Node inspector
- **Clean**: `npm run clean` - Removes build artifacts and dependencies

### Testing
- **Unit Tests**: `npm run test` - Runs unit tests for all packages
- **Integration Tests**: `npm run test:e2e` - End-to-end integration tests
- **All Integration Tests**: `npm run test:integration:all` - Tests with different sandbox configurations
- **CI Test Suite**: `npm run test:ci` - Full test suite for continuous integration
- **Preflight Check**: `npm run preflight` - Complete validation (clean, install, format, lint, build, typecheck, test)

### Code Quality
- **Lint**: `npm run lint` - ESLint for TypeScript and JavaScript files
- **Lint Fix**: `npm run lint:fix` - Auto-fix linting issues
- **Format**: `npm run format` - Prettier code formatting
- **Typecheck**: `npm run typecheck` - TypeScript type checking across packages

### Building Specific Components
- **All Components**: `npm run build:all` - Build CLI, sandbox, and VS Code extension
- **Packages**: `npm run build:packages` - Build workspace packages only
- **Sandbox**: `npm run build:sandbox` - Build container sandbox environment
- **VS Code Extension**: `npm run build:vscode` - Build IDE companion extension

## Architecture Overview

### Package Structure
This is a monorepo with three main packages:

1. **`packages/cli/`** - User-facing terminal interface
   - React-based TUI using Ink framework
   - Input processing, command handling, UI rendering
   - Theme system, history management
   - Agent management and multi-provider support

2. **`packages/core/`** - Backend logic and API integration
   - Gemini API client and request handling
   - Tool registry and execution system
   - Prompt construction and conversation management
   - Multi-provider system (Gemini, Claude, Ollama)
   - File system operations, shell execution, web tools

3. **`packages/vscode-ide-companion/`** - VS Code extension
   - IDE integration for enhanced code assistance
   - File watching and diff management

### Multi-Provider Architecture
The system supports multiple AI providers through a unified interface:

- **Provider Clients**: `packages/core/src/providers/` - Individual implementations for Gemini, Claude, Ollama
- **Agent Management**: `packages/core/src/providers/manager/` - Orchestrates multiple concurrent agents
- **Tool Integration**: Provider-aware tool registry with capability filtering
- **Session Management**: Concurrent session handling with provider-specific configurations

### Key Components
- **Tool System**: Extensible tool architecture in `packages/core/src/tools/`
- **Authentication**: Multiple auth methods (API keys, OAuth, Vertex AI)
- **Sandboxing**: Container-based and macOS Seatbelt sandboxing for security
- **Telemetry**: Usage analytics and error reporting
- **MCP Integration**: Model Context Protocol server support

## Development Setup

### Prerequisites
- Node.js ~20.19.0 (development), >=20 (production)
- For sandboxing: Docker, Podman, or macOS Seatbelt

### Environment Configuration
```bash
# Gemini API
export GEMINI_API_KEY="your-key"

# Claude API  
export ANTHROPIC_API_KEY="your-key"

# Ollama (local/remote)
export OLLAMA_HOST="http://localhost:11434"

# Vertex AI
export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_API_KEY="your-vertex-key"
```

### Configuration Files
- `package.json` - Root package configuration and scripts
- `tsconfig.json` - TypeScript configuration
- `eslint.config.js` - ESLint rules and setup
- `.gemini/settings.json` - User configuration and multi-provider settings

## Common Development Patterns

### Adding New Tools
1. Create tool implementation in `packages/core/src/tools/`
2. Register in `packages/core/src/tools/tool-registry.ts`
3. Add provider compatibility in `packages/core/src/providers/tools/`
4. Include appropriate tests

### Agent Management
The system supports creating and managing multiple AI agents:
```bash
# Create agents for different providers
gemini agent create "Code Helper" gemini
gemini agent create "Writing Assistant" claude  
gemini agent create "Local Model" ollama

# Switch between agents
gemini agent switch "Code Helper"
```

### Debugging
- Use `npm run debug` and attach Chrome DevTools via `chrome://inspect`
- React DevTools: `DEV=true npm start` then `npx react-devtools@4.28.5`
- Sandbox debugging: `DEBUG=1 gemini`

## Testing Strategy

### Test Types
- **Unit Tests**: Individual component/function testing
- **Integration Tests**: End-to-end workflow validation
- **Provider Tests**: Multi-provider functionality testing
- **UI Tests**: React component testing with snapshots

### Running Specific Tests
- Single test file: `npm test -- path/to/test.file.ts`
- Integration tests without sandbox: `npm run test:integration:sandbox:none`
- With Docker sandbox: `npm run test:integration:sandbox:docker`

## Code Style Guidelines

### TypeScript Conventions
- Strict type checking enabled across all packages
- ESLint enforces import restrictions between packages
- Use existing patterns for React components (Ink-based TUI)
- Follow established naming conventions for providers and tools

### Import Structure
- Relative imports restricted between packages (enforced by ESLint)
- Use package exports for cross-package dependencies
- Tool imports through registry system

### Authentication Patterns
- API keys via environment variables
- OAuth flows for Google services
- Secure credential storage and handling
- No credentials in logs or UI displays