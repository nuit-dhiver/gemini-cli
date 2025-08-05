# Chat Stream Migration Guide

This document describes the migration from the Gemini-specific `useGeminiStream` hook to the provider-agnostic `useChatStream` hook.

## Overview

The new chat streaming system replaces Gemini-specific event types and stream hooks with a generic, provider-agnostic event bus that supports multiple AI providers (Gemini, Claude, Ollama).

## Key Changes

### Before (Gemini-specific)
```typescript
import { useGeminiStream, GeminiEventType } from './hooks/useGeminiStream.js';

// Gemini-specific event handling
const { streamingState, submitQuery } = useGeminiStream(
  geminiClient,
  history,
  addItem,
  config,
  // ... other params
);
```

### After (Provider-agnostic)
```typescript
import { useChatStream, ChatStreamEventType } from './hooks/useChatStream.js';

// Provider-agnostic event handling
const { streamingState, submitQuery, eventBus } = useChatStream(
  chatSession, // ChatSession interface instead of GeminiClient
  history,
  addItem,
  config,
  // ... other params
);
```

## Event System Changes

### Old Gemini Events → New Chat Events

| Old Gemini Event | New Chat Event | Description |
|------------------|----------------|-------------|
| `GeminiEventType.Content` | `ChatStreamEventType.CONTENT` | Content streaming |
| `GeminiEventType.ToolCallRequest` | `ChatStreamEventType.TOOL_CALL` | Tool execution request |
| `GeminiEventType.ToolCallResponse` | `ChatStreamEventType.TOOL_RESULT` | Tool execution result |
| `GeminiEventType.UserCancelled` | `ChatStreamEventType.CANCELLED` | User cancellation |
| `GeminiEventType.Error` | `ChatStreamEventType.ERROR` | Error events |
| `GeminiEventType.Finished` | `ChatStreamEventType.END` | Stream completion |
| `GeminiEventType.Thought` | `ChatStreamEventType.THOUGHT` | AI reasoning |
| `GeminiEventType.ChatCompressed` | `ChatStreamEventType.CONTEXT_COMPRESSED` | Context compression |
| `GeminiEventType.LoopDetected` | `ChatStreamEventType.LOOP_DETECTED` | Loop detection |

### New Event Types

The new system introduces additional event types for better provider support:

- `ChatStreamEventType.TOKEN` - Individual token streaming
- `ChatStreamEventType.START` - Stream start
- `ChatStreamEventType.PAUSE` - Stream pause
- `ChatStreamEventType.RESUME` - Stream resume
- `ChatStreamEventType.TIMEOUT` - Request timeout
- `ChatStreamEventType.PROVIDER_SWITCHED` - AI provider changed

## Architecture Components

### 1. Event Bus System

```typescript
import { createChatEventBus } from '../utils/chatEventBus.js';

const eventBus = createChatEventBus();

// Subscribe to specific events
const unsubscribe = eventBus.on(ChatStreamEventType.CONTENT, (event) => {
  console.log('Received content:', event.data);
});

// Subscribe to all events
const unsubscribeAll = eventBus.onAny((event) => {
  console.log('Any event:', event.type, event.data);
});

// Emit events
eventBus.emit({
  type: ChatStreamEventType.CONTENT,
  provider: AIProvider.GEMINI,
  timestamp: Date.now(),
  data: 'Hello world',
});
```

### 2. Provider-Agnostic Events

All events follow a consistent structure:

```typescript
interface BaseChatStreamEvent<T = any> {
  type: ChatStreamEventType;
  provider: AIProvider;        // Which AI provider
  timestamp: number;           // When the event occurred
  sessionId?: string;          // Session identifier
  data?: T;                    // Event-specific data
}
```

### 3. Event Conversion

The system automatically converts provider-specific events to generic chat events:

```typescript
// Gemini event → Generic chat event
const geminiEvent = { type: 'content', value: 'Hello' };
const chatEvent = EventConverters.fromGeminiEvent(
  geminiEvent,
  AIProvider.GEMINI,
  sessionId
);
// Result: { type: 'content', provider: 'gemini', data: 'Hello', ... }
```

## Migration Steps

### Step 1: Update Imports

```diff
- import { useGeminiStream } from './hooks/useGeminiStream.js';
+ import { useChatStream } from './hooks/useChatStream.js';
```

For backward compatibility, you can also use:
```typescript
import { useGeminiStream } from './hooks/useGeminiStreamCompat.js';
```

### Step 2: Replace GeminiClient with ChatSession

```diff
- const geminiClient = config.getGeminiClient();
+ const chatSession = await config.getActiveChatSession();

const {
  streamingState,
  submitQuery,
  // ...
} = useChatStream(
-  geminiClient,
+  chatSession,
  history,
  addItem,
  // ...
);
```

### Step 3: Update Event Handling

```diff
// Event type constants
- import { GeminiEventType } from '@google/gemini-cli-core';
+ import { ChatStreamEventType } from '../types/chatEvents.js';

// Event handling
- switch (event.type) {
-   case GeminiEventType.Content:
+ switch (event.type) {
+   case ChatStreamEventType.CONTENT:
```

### Step 4: Use Event Bus (Optional)

Access the event bus for advanced event handling:

```typescript
const { eventBus } = useChatStream(/* ... */);

// Wait for specific events
const endEvent = await eventBus.waitFor(ChatStreamEventType.END, 5000);

// Create filtered event streams
const contentStream = eventBus.createFilteredStream([
  ChatStreamEventType.CONTENT,
  ChatStreamEventType.TOKEN,
]);

for await (const event of contentStream) {
  console.log('Content event:', event.data);
}
```

## Multi-Provider Support

### Switching Providers

```typescript
// Switch to Claude
const claudeSession = await config.createChatSession(
  AIProvider.CLAUDE,
  'claude-3-5-sonnet'
);

// The hook automatically handles provider-specific events
const { streamingState } = useChatStream(
  claudeSession,
  // ... other params
);
```

### Provider-Specific Configuration

```typescript
const streamConfig = {
  provider: AIProvider.GEMINI,
  enableThoughts: true,      // Gemini-specific
  enableToolCalls: true,
  bufferEvents: false,
};

const { streamingState } = useChatStream(
  chatSession,
  // ... other params
  streamConfig
);
```

## Testing

### Testing Events

```typescript
import { createChatEventBus, ChatStreamEventType } from '../utils/chatEventBus.js';

const eventBus = createChatEventBus();
const events: ChatStreamEvent[] = [];

eventBus.onAny(event => events.push(event));

// Emit test events
eventBus.emit({
  type: ChatStreamEventType.CONTENT,
  provider: AIProvider.GEMINI,
  timestamp: Date.now(),
  data: 'test content',
});

expect(events).toHaveLength(1);
expect(events[0].type).toBe(ChatStreamEventType.CONTENT);
```

### Mock Chat Session

```typescript
const mockChatSession = {
  sessionId: 'test-123',
  provider: AIProvider.GEMINI,
  model: 'gemini-2.0-flash',
  sendMessageStream: vi.fn(),
  getHistory: vi.fn(() => []),
  addHistory: vi.fn(),
};
```

## Benefits

### 1. Provider Independence
- Support for multiple AI providers (Gemini, Claude, Ollama)
- Easy to add new providers
- Consistent API across providers

### 2. Better Event Management
- Unified event system
- Event filtering and transformation
- Event history and statistics
- Async event waiting

### 3. Enhanced Debugging
- Event history tracking
- Provider-agnostic logging
- Performance metrics
- Error handling consistency

### 4. Backward Compatibility
- Existing code continues to work
- Gradual migration path
- Compatible interfaces

## Advanced Usage

### Custom Event Handlers

```typescript
const { eventBus } = useChatStream(/* ... */);

// Handle multiple event types
const unsubscribe = eventBus.on([
  ChatStreamEventType.ERROR,
  ChatStreamEventType.TIMEOUT,
], (event) => {
  if (event.type === ChatStreamEventType.ERROR) {
    console.error('Chat error:', event.data.message);
  } else if (event.type === ChatStreamEventType.TIMEOUT) {
    console.warn('Chat timeout:', event.data.timeoutMs);
  }
});
```

### Event Statistics

```typescript
const stats = eventBus.getStats();
console.log('Total events:', stats.totalEvents);
console.log('Events by type:', stats.eventsByType);
console.log('Active listeners:', stats.activeListeners);
console.log('Current provider:', stats.currentProvider);
```

### Event Filtering

```typescript
// Only listen to content and token events
const contentStream = eventBus.createFilteredStream([
  ChatStreamEventType.CONTENT,
  ChatStreamEventType.TOKEN,
]);

// Process content in real-time
for await (const event of contentStream) {
  updateUI(event.data);
}
```

This migration provides a solid foundation for multi-provider chat streaming while maintaining backward compatibility and improving the overall architecture.