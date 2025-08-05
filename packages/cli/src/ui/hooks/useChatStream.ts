/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useInput } from 'ink';
import {
  Config,
  ChatSession,
  AIProvider,
  ToolCallRequestInfo,
  logUserPrompt,
  GitService,
  EditorType,
  UnauthorizedError,
  UserPromptEvent,
  isNodeError,
  getErrorMessage,
} from '@google/gemini-cli-core';
import { type Part, type PartListUnion, FinishReason } from '@google/genai';
import {
  StreamingState,
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  MessageType,
  SlashCommandProcessorResult,
  ToolCallStatus,
} from '../types.js';
import {
  ChatStreamEvent,
  ChatStreamEventType,
  ChatStreamEventBus,
  ChatStreamConfig,
  ChatStreamState,
  ChatStreamStatus,
  TokenEvent,
  ContentEvent,
  ThoughtEvent,
  ToolCallEvent,
  ToolResultEvent,
  ErrorEvent,
  EndEvent,
  CancelledEvent,
  ContextCompressedEvent,
  SessionLimitEvent,
  LoopDetectedEvent,
} from '../types/chatEvents.js';
import { createChatEventBus, EventConverters } from '../utils/chatEventBus.js';
import { isAtCommand } from '../utils/commandUtils.js';
import { parseAndFormatApiError } from '../utils/errorParsing.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';
import { handleAtCommand } from './atCommandProcessor.js';
import { findLastSafeSplitPoint } from '../utils/markdownUtilities.js';
import { useStateAndRef } from './useStateAndRef.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useLogger } from './useLogger.js';
import { promises as fs } from 'fs';
import path from 'path';
import {
  useReactToolScheduler,
  mapToDisplay as mapTrackedToolCallsToDisplay,
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { useSessionStats } from '../contexts/SessionContext.js';

export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: PartListUnion = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      resultParts.push(...item);
    } else {
      resultParts.push(item);
    }
  }
  return resultParts;
}

enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

/**
 * Configuration for the chat stream hook
 */
export interface UseChatStreamConfig {
  provider?: AIProvider;
  model?: string;
  sessionId?: string;
  enableThoughts?: boolean;
  enableToolCalls?: boolean;
  bufferEvents?: boolean;
  bufferTimeoutMs?: number;
}

/**
 * Provider-agnostic chat streaming hook that replaces useGeminiStream
 * Supports multiple AI providers through a unified event bus system
 */
export const useChatStream = (
  chatSession: ChatSession,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
  modelSwitchedFromQuotaError: boolean,
  setModelSwitchedFromQuotaError: React.Dispatch<React.SetStateAction<boolean>>,
  streamConfig?: UseChatStreamConfig,
) => {
  // Event bus for provider-agnostic event handling
  const eventBus = useMemo(() => createChatEventBus(), []);
  
  // Stream state
  const [streamState, setStreamState] = useState<ChatStreamState>(ChatStreamState.IDLE);
  const [streamStatus, setStreamStatus] = useState<ChatStreamStatus>({
    state: ChatStreamState.IDLE,
    provider: chatSession.provider,
    model: chatSession.model,
    sessionId: chatSession.sessionId,
  });

  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [thought, setThought] = useState<{ subject: string; description: string } | null>(null);
  const [pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const processedMemoryToolsRef = useRef<Set<string>>(new Set());
  const { startNewPrompt, getPromptCount } = useSessionStats();
  const logger = useLogger();
  
  const gitService = useMemo(() => {
    if (!config.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot());
  }, [config]);

  const [toolCalls, scheduleToolCalls, markToolsAsSubmitted] =
    useReactToolScheduler(
      async (completedToolCallsFromScheduler) => {
        // This onComplete is called when ALL scheduled tools for a given batch are done.
        if (completedToolCallsFromScheduler.length > 0) {
          // Add the final state of these tools to the history for display.
          addItem(
            mapTrackedToolCallsToDisplay(
              completedToolCallsFromScheduler as TrackedToolCall[],
            ),
            Date.now(),
          );

          // Handle tool response submission immediately when tools complete
          await handleCompletedTools(
            completedToolCallsFromScheduler as TrackedToolCall[],
          );
        }
      },
      config,
      setPendingHistoryItem,
      getPreferredEditor,
    );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length ? mapTrackedToolCallsToDisplay(toolCalls) : undefined,
    [toolCalls],
  );

  const loopDetectedRef = useRef(false);

  // Convert StreamingState from tool calls to ChatStreamState
  const streamingState = useMemo(() => {
    if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
      return StreamingState.WaitingForConfirmation;
    }
    if (
      isResponding ||
      toolCalls.some(
        (tc) =>
          tc.status === 'executing' ||
          tc.status === 'scheduled' ||
          tc.status === 'validating' ||
          ((tc.status === 'success' ||
            tc.status === 'error' ||
            tc.status === 'cancelled') &&
            !(tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini),
      )
    ) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);

  // Update stream status when state changes
  useEffect(() => {
    const newStatus: ChatStreamStatus = {
      state: streamState,
      provider: chatSession.provider,
      model: chatSession.model,
      sessionId: chatSession.sessionId,
      currentThought: thought || undefined,
      pendingToolCalls: toolCalls.map(tc => ({
        callId: tc.request.callId,
        name: tc.request.name,
        status: tc.status === 'awaiting_approval' ? 'awaiting_confirmation' :
                tc.status === 'executing' ? 'executing' : 'pending',
      })),
    };
    setStreamStatus(newStatus);
  }, [streamState, chatSession, thought, toolCalls]);

  // Event bus handlers
  useEffect(() => {
    const unsubscribeToken = eventBus.on(ChatStreamEventType.TOKEN, (event: TokenEvent) => {
      handleContentEvent(event.data, '', Date.now());
    });

    const unsubscribeContent = eventBus.on(ChatStreamEventType.CONTENT, (event: ContentEvent) => {
      handleContentEvent(event.data, '', Date.now());
    });

    const unsubscribeThought = eventBus.on(ChatStreamEventType.THOUGHT, (event: ThoughtEvent) => {
      setThought(event.data);
    });

    const unsubscribeToolCall = eventBus.on(ChatStreamEventType.TOOL_CALL, (event: ToolCallEvent) => {
      const toolCallRequest: ToolCallRequestInfo = {
        callId: event.data.callId,
        name: event.data.name,
        args: event.data.args,
        isClientInitiated: event.data.isClientInitiated,
        prompt_id: event.sessionId || config.getSessionId(),
      };
      scheduleToolCalls([toolCallRequest], abortControllerRef.current?.signal || new AbortController().signal);
    });

    const unsubscribeError = eventBus.on(ChatStreamEventType.ERROR, (event: ErrorEvent) => {
      handleErrorEvent(event, Date.now());
    });

    const unsubscribeEnd = eventBus.on(ChatStreamEventType.END, (event: EndEvent) => {
      handleFinishedEvent(event, Date.now());
      setStreamState(ChatStreamState.FINISHED);
    });

    const unsubscribeCancelled = eventBus.on(ChatStreamEventType.CANCELLED, (event: CancelledEvent) => {
      handleUserCancelledEvent(Date.now());
      setStreamState(ChatStreamState.CANCELLED);
    });

    const unsubscribeCompressed = eventBus.on(ChatStreamEventType.CONTEXT_COMPRESSED, (event: ContextCompressedEvent) => {
      handleChatCompressionEvent(event);
    });

    const unsubscribeSessionLimit = eventBus.on(ChatStreamEventType.SESSION_LIMIT, (event: SessionLimitEvent) => {
      handleMaxSessionTurnsEvent();
    });

    const unsubscribeLoopDetected = eventBus.on(ChatStreamEventType.LOOP_DETECTED, (event: LoopDetectedEvent) => {
      loopDetectedRef.current = true;
    });

    return () => {
      unsubscribeToken();
      unsubscribeContent();
      unsubscribeThought();
      unsubscribeToolCall();
      unsubscribeError();
      unsubscribeEnd();
      unsubscribeCancelled();
      unsubscribeCompressed();
      unsubscribeSessionLimit();
      unsubscribeLoopDetected();
    };
  }, [eventBus, config, scheduleToolCalls]);

  const onExec = useCallback(async (done: Promise<void>) => {
    setIsResponding(true);
    setStreamState(ChatStreamState.STREAMING);
    await done;
    setIsResponding(false);
    setStreamState(ChatStreamState.IDLE);
  }, []);

  const { handleShellCommand } = useShellCommandProcessor(
    addItem,
    setPendingHistoryItem,
    onExec,
    onDebugMessage,
    config,
    // Pass a compatibility layer for GeminiClient interface
    {
      addHistory: (content: any) => chatSession.addHistory(content),
      getHistory: () => chatSession.getHistory(),
    } as any,
  );

  useInput((_input, key) => {
    if (streamingState === StreamingState.Responding && key.escape) {
      if (turnCancelledRef.current) {
        return;
      }
      turnCancelledRef.current = true;
      abortControllerRef.current?.abort();
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, Date.now());
      }
      addItem(
        {
          type: MessageType.INFO,
          text: 'Request cancelled.',
        },
        Date.now(),
      );
      setPendingHistoryItem(null);
      setIsResponding(false);
      setStreamState(ChatStreamState.CANCELLED);
      
      // Emit cancelled event
      eventBus.emit({
        type: ChatStreamEventType.CANCELLED,
        provider: chatSession.provider,
        timestamp: Date.now(),
        sessionId: chatSession.sessionId,
        data: { reason: 'user' },
      });
    }
  });

  const prepareQueryForChat = useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
      prompt_id: string,
    ): Promise<{
      queryToSend: PartListUnion | null;
      shouldProceed: boolean;
    }> => {
      if (turnCancelledRef.current) {
        return { queryToSend: null, shouldProceed: false };
      }
      if (typeof query === 'string' && query.trim().length === 0) {
        return { queryToSend: null, shouldProceed: false };
      }

      let localQueryToSendToChat: PartListUnion | null = null;

      if (typeof query === 'string') {
        const trimmedQuery = query.trim();
        logUserPrompt(
          config,
          new UserPromptEvent(
            trimmedQuery.length,
            prompt_id,
            config.getContentGeneratorConfig()?.authType,
            trimmedQuery,
          ),
        );
        onDebugMessage(`User query: '${trimmedQuery}'`);
        await logger?.logMessage('user' as any, trimmedQuery);

        // Handle UI-only commands first
        const slashCommandResult = await handleSlashCommand(trimmedQuery);

        if (slashCommandResult) {
          switch (slashCommandResult.type) {
            case 'schedule_tool': {
              const { toolName, toolArgs } = slashCommandResult;
              const toolCallRequest: ToolCallRequestInfo = {
                callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: toolName,
                args: toolArgs,
                isClientInitiated: true,
                prompt_id,
              };
              scheduleToolCalls([toolCallRequest], abortSignal);
              return { queryToSend: null, shouldProceed: false };
            }
            case 'submit_prompt': {
              localQueryToSendToChat = slashCommandResult.content;
              return {
                queryToSend: localQueryToSendToChat,
                shouldProceed: true,
              };
            }
            case 'handled': {
              return { queryToSend: null, shouldProceed: false };
            }
            default: {
              const unreachable: never = slashCommandResult;
              throw new Error(
                `Unhandled slash command result type: ${unreachable}`,
              );
            }
          }
        }

        if (shellModeActive && handleShellCommand(trimmedQuery, abortSignal)) {
          return { queryToSend: null, shouldProceed: false };
        }

        // Handle @-commands (which might involve tool calls)
        if (isAtCommand(trimmedQuery)) {
          const atCommandResult = await handleAtCommand({
            query: trimmedQuery,
            config,
            addItem,
            onDebugMessage,
            messageId: userMessageTimestamp,
            signal: abortSignal,
          });
          if (!atCommandResult.shouldProceed) {
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToChat = atCommandResult.processedQuery;
        } else {
          // Normal query for Chat
          addItem(
            { type: MessageType.USER, text: trimmedQuery },
            userMessageTimestamp,
          );
          localQueryToSendToChat = trimmedQuery;
        }
      } else {
        // It's a function response (PartListUnion that isn't a string)
        localQueryToSendToChat = query;
      }

      if (localQueryToSendToChat === null) {
        onDebugMessage(
          'Query processing resulted in null, not sending to chat session.',
        );
        return { queryToSend: null, shouldProceed: false };
      }
      return { queryToSend: localQueryToSendToChat, shouldProceed: true };
    },
    [
      config,
      addItem,
      onDebugMessage,
      handleShellCommand,
      handleSlashCommand,
      logger,
      shellModeActive,
      scheduleToolCalls,
    ],
  );

  // --- Stream Event Handlers ---

  const handleContentEvent = useCallback(
    (
      eventValue: string,
      currentMessageBuffer: string,
      userMessageTimestamp: number,
    ): string => {
      if (turnCancelledRef.current) {
        // Prevents additional output after a user initiated cancel.
        return '';
      }
      let newMessageBuffer = currentMessageBuffer + eventValue;
      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem({ type: 'gemini', text: '' });
        newMessageBuffer = eventValue;
      }
      // Split large messages for better rendering performance
      const splitPoint = findLastSafeSplitPoint(newMessageBuffer);
      if (splitPoint === newMessageBuffer.length) {
        // Update the existing message with accumulated content
        setPendingHistoryItem((item) => ({
          type: item?.type as 'gemini' | 'gemini_content',
          text: newMessageBuffer,
        }));
      } else {
        // Split the message for performance
        const beforeText = newMessageBuffer.substring(0, splitPoint);
        const afterText = newMessageBuffer.substring(splitPoint);
        addItem(
          {
            type: pendingHistoryItemRef.current?.type as
              | 'gemini'
              | 'gemini_content',
            text: beforeText,
          },
          userMessageTimestamp,
        );
        setPendingHistoryItem({ type: 'gemini_content', text: afterText });
        newMessageBuffer = afterText;
      }
      return newMessageBuffer;
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleUserCancelledEvent = useCallback(
    (userMessageTimestamp: number) => {
      if (turnCancelledRef.current) {
        return;
      }
      if (pendingHistoryItemRef.current) {
        if (pendingHistoryItemRef.current.type === 'tool_group') {
          const updatedTools = pendingHistoryItemRef.current.tools.map(
            (tool) =>
              tool.status === ToolCallStatus.Pending ||
              tool.status === ToolCallStatus.Confirming ||
              tool.status === ToolCallStatus.Executing
                ? { ...tool, status: ToolCallStatus.Canceled }
                : tool,
          );
          const pendingItem: HistoryItemToolGroup = {
            ...pendingHistoryItemRef.current,
            tools: updatedTools,
          };
          addItem(pendingItem, userMessageTimestamp);
        } else {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem(null);
      }
      addItem(
        { type: MessageType.INFO, text: 'User cancelled the request.' },
        userMessageTimestamp,
      );
      setIsResponding(false);
      setThought(null);
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, setThought],
  );

  const handleErrorEvent = useCallback(
    (event: ErrorEvent, userMessageTimestamp: number) => {
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            event.data.message,
            config.getContentGeneratorConfig()?.authType,
            undefined,
            chatSession.model,
            'gemini-2.0-flash-exp', // Default fallback model
          ),
        },
        userMessageTimestamp,
      );
      setThought(null);
      setStreamState(ChatStreamState.ERROR);
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, config, setThought, chatSession.model],
  );

  const handleFinishedEvent = useCallback(
    (event: EndEvent, userMessageTimestamp: number) => {
      const finishReason = event.data.reason;

      // Handle different finish reasons
      const finishReasonMessages: Record<string, string | undefined> = {
        'FINISH_REASON_UNSPECIFIED': undefined,
        'STOP': undefined,
        'MAX_TOKENS': 'Response truncated due to token limits.',
        'SAFETY': 'Response stopped due to safety reasons.',
        'RECITATION': 'Response stopped due to recitation policy.',
        'LANGUAGE': 'Response stopped due to unsupported language.',
        'BLOCKLIST': 'Response stopped due to forbidden terms.',
        'PROHIBITED_CONTENT': 'Response stopped due to prohibited content.',
        'SPII': 'Response stopped due to sensitive personally identifiable information.',
        'OTHER': 'Response stopped for other reasons.',
        'MALFORMED_FUNCTION_CALL': 'Response stopped due to malformed function call.',
        'IMAGE_SAFETY': 'Response stopped due to image safety violations.',
        'UNEXPECTED_TOOL_CALL': 'Response stopped due to unexpected tool call.',
      };

      const message = finishReasonMessages[finishReason as string];
      if (message) {
        addItem(
          {
            type: 'info',
            text: `⚠️  ${message}`,
          },
          userMessageTimestamp,
        );
      }
    },
    [addItem],
  );

  const handleChatCompressionEvent = useCallback(
    (event: ContextCompressedEvent) =>
      addItem(
        {
          type: 'info',
          text:
            `IMPORTANT: This conversation approached the input token limit for ${chatSession.model}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${event.data.originalTokenCount} to ` +
            `${event.data.newTokenCount} tokens).`,
        },
        Date.now(),
      ),
    [addItem, chatSession.model],
  );

  const handleMaxSessionTurnsEvent = useCallback(
    () =>
      addItem(
        {
          type: 'info',
          text:
            `The session has reached the maximum number of turns: ${config.getMaxSessionTurns()}. ` +
            `Please update this limit in your setting.json file.`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const handleLoopDetectedEvent = useCallback(() => {
    addItem(
      {
        type: 'info',
        text: `A potential loop was detected. This can happen due to repetitive tool calls or other model behavior. The request has been halted.`,
      },
      Date.now(),
    );
  }, [addItem]);

  const processChatStreamEvents = useCallback(
    async (
      stream: AsyncIterable<any>, // Provider-specific stream
      userMessageTimestamp: number,
      signal: AbortSignal,
    ): Promise<StreamProcessingStatus> => {
      setStreamState(ChatStreamState.STREAMING);
      
      try {
        for await (const event of stream) {
          // Convert provider-specific events to generic chat events
          let chatEvent: ChatStreamEvent | null = null;
          
          // Use the appropriate converter based on provider
          switch (chatSession.provider) {
            case AIProvider.GEMINI:
              chatEvent = EventConverters.fromGeminiEvent(
                event,
                chatSession.provider,
                chatSession.sessionId,
              );
              break;
            case AIProvider.CLAUDE:
              chatEvent = EventConverters.fromClaudeEvent(
                event,
                chatSession.provider,
                chatSession.sessionId,
              );
              break;
            case AIProvider.OLLAMA:
              chatEvent = EventConverters.fromOllamaEvent(
                event,
                chatSession.provider,
                chatSession.sessionId,
              );
              break;
          }

          // Emit the converted event
          if (chatEvent) {
            eventBus.emit(chatEvent);
          }
        }
        
        setStreamState(ChatStreamState.FINISHED);
        return StreamProcessingStatus.Completed;
      } catch (error) {
        setStreamState(ChatStreamState.ERROR);
        
        // Emit error event
        eventBus.emit({
          type: ChatStreamEventType.ERROR,
          provider: chatSession.provider,
          timestamp: Date.now(),
          sessionId: chatSession.sessionId,
          data: {
            message: getErrorMessage(error) || 'Unknown error',
            recoverable: false,
          },
        });
        
        return StreamProcessingStatus.Error;
      }
    },
    [eventBus, chatSession],
  );

  const submitQuery = useCallback(
    async (
      query: PartListUnion,
      options?: { isContinuation: boolean },
      prompt_id?: string,
    ) => {
      if (
        (streamingState === StreamingState.Responding ||
          streamingState === StreamingState.WaitingForConfirmation) &&
        !options?.isContinuation
      )
        return;

      const userMessageTimestamp = Date.now();

      // Reset quota error flag when starting a new query (not a continuation)
      if (!options?.isContinuation) {
        setModelSwitchedFromQuotaError(false);
        config.setQuotaErrorOccurred?.(false);
      }

      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;
      turnCancelledRef.current = false;

      if (!prompt_id) {
        prompt_id = config.getSessionId() + '########' + getPromptCount();
      }

      const { queryToSend, shouldProceed } = await prepareQueryForChat(
        query,
        userMessageTimestamp,
        abortSignal,
        prompt_id!,
      );

      if (!shouldProceed || queryToSend === null) {
        return;
      }

      if (!options?.isContinuation) {
        startNewPrompt();
        setThought(null);
      }

      setIsResponding(true);
      setInitError(null);
      setStreamState(ChatStreamState.STREAMING);

      try {
        // Emit start event
        eventBus.emit({
          type: ChatStreamEventType.START,
          provider: chatSession.provider,
          timestamp: Date.now(),
          sessionId: chatSession.sessionId,
          data: {
            model: chatSession.model,
            provider: chatSession.provider,
          },
        });

        const stream = chatSession.sendMessageStream(
          {
            message: queryToSend,
            config: {
              abortSignal,
            },
          },
          prompt_id!,
        );
        
        const processingStatus = await processChatStreamEvents(
          stream,
          userMessageTimestamp,
          abortSignal,
        );

        if (processingStatus === StreamProcessingStatus.UserCancelled) {
          return;
        }

        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
          setPendingHistoryItem(null);
        }
        if (loopDetectedRef.current) {
          loopDetectedRef.current = false;
          handleLoopDetectedEvent();
        }
      } catch (error: unknown) {
        if (error instanceof UnauthorizedError) {
          onAuthError();
        } else if (!isNodeError(error) || error.name !== 'AbortError') {
          addItem(
            {
              type: MessageType.ERROR,
              text: parseAndFormatApiError(
                getErrorMessage(error) || 'Unknown error',
                config.getContentGeneratorConfig()?.authType,
                undefined,
                chatSession.model,
                'gemini-2.0-flash-exp',
              ),
            },
            userMessageTimestamp,
          );
        }
      } finally {
        setIsResponding(false);
        setStreamState(ChatStreamState.IDLE);
      }
    },
    [
      streamingState,
      setModelSwitchedFromQuotaError,
      prepareQueryForChat,
      processChatStreamEvents,
      pendingHistoryItemRef,
      addItem,
      setPendingHistoryItem,
      setInitError,
      chatSession,
      onAuthError,
      config,
      startNewPrompt,
      getPromptCount,
      handleLoopDetectedEvent,
      eventBus,
    ],
  );

  const handleCompletedTools = useCallback(
    async (completedToolCallsFromScheduler: TrackedToolCall[]) => {
      if (isResponding) {
        return;
      }

      const completedAndReadyToSubmitTools =
        completedToolCallsFromScheduler.filter(
          (
            tc: TrackedToolCall,
          ): tc is TrackedCompletedToolCall | TrackedCancelledToolCall => {
            const isTerminalState =
              tc.status === 'success' ||
              tc.status === 'error' ||
              tc.status === 'cancelled';

            if (isTerminalState) {
              const completedOrCancelledCall = tc as
                | TrackedCompletedToolCall
                | TrackedCancelledToolCall;
              return (
                completedOrCancelledCall.response?.responseParts !== undefined
              );
            }
            return false;
          },
        );

      // Finalize any client-initiated tools as soon as they are done.
      const clientTools = completedAndReadyToSubmitTools.filter(
        (t) => t.request.isClientInitiated,
      );
      if (clientTools.length > 0) {
        markToolsAsSubmitted(clientTools.map((t) => t.request.callId));
      }

      // Identify new, successful save_memory calls that we haven't processed yet.
      const newSuccessfulMemorySaves = completedAndReadyToSubmitTools.filter(
        (t) =>
          t.request.name === 'save_memory' &&
          t.status === 'success' &&
          !processedMemoryToolsRef.current.has(t.request.callId),
      );

      if (newSuccessfulMemorySaves.length > 0) {
        // Perform the refresh only if there are new ones.
        void performMemoryRefresh();
        // Mark them as processed so we don't do this again on the next render.
        newSuccessfulMemorySaves.forEach((t) =>
          processedMemoryToolsRef.current.add(t.request.callId),
        );
      }

      const chatTools = completedAndReadyToSubmitTools.filter(
        (t) => !t.request.isClientInitiated,
      );

      if (chatTools.length === 0) {
        return;
      }

      // If all the tools were cancelled, don't submit a response to the chat session.
      const allToolsCancelled = chatTools.every(
        (tc) => tc.status === 'cancelled',
      );

      if (allToolsCancelled) {
        // We need to manually add the function responses to the history
        // so the model knows the tools were cancelled.
        const responsesToAdd = chatTools.flatMap(
          (toolCall) => toolCall.response.responseParts,
        );
        const combinedParts: Part[] = [];
        for (const response of responsesToAdd) {
          if (Array.isArray(response)) {
            combinedParts.push(...response);
          } else if (typeof response === 'string') {
            combinedParts.push({ text: response });
          } else {
            combinedParts.push(response);
          }
        }
        chatSession.addHistory({
          role: 'user',
          parts: combinedParts,
        });

        const callIdsToMarkAsSubmitted = chatTools.map(
          (toolCall) => toolCall.request.callId,
        );
        markToolsAsSubmitted(callIdsToMarkAsSubmitted);
        return;
      }

      const responsesToSend: PartListUnion[] = chatTools.map(
        (toolCall) => toolCall.response.responseParts,
      );
      const callIdsToMarkAsSubmitted = chatTools.map(
        (toolCall) => toolCall.request.callId,
      );

      const prompt_ids = chatTools.map(
        (toolCall) => toolCall.request.prompt_id,
      );

      markToolsAsSubmitted(callIdsToMarkAsSubmitted);

      // Don't continue if model was switched due to quota error
      if (modelSwitchedFromQuotaError) {
        return;
      }

      submitQuery(
        mergePartListUnions(responsesToSend),
        {
          isContinuation: true,
        },
        prompt_ids[0],
      );
    },
    [
      isResponding,
      submitQuery,
      markToolsAsSubmitted,
      chatSession,
      performMemoryRefresh,
      modelSwitchedFromQuotaError,
    ],
  );

  const pendingHistoryItems = [
    pendingHistoryItemRef.current,
    pendingToolCallGroupDisplay,
  ].filter((i) => i !== undefined && i !== null);

  // Checkpoint restoration logic remains the same but uses chatSession instead of geminiClient
  useEffect(() => {
    const saveRestorableToolCalls = async () => {
      if (!config.getCheckpointingEnabled()) {
        return;
      }
      const restorableToolCalls = toolCalls.filter(
        (toolCall) =>
          (toolCall.request.name === 'replace' ||
            toolCall.request.name === 'write_file') &&
          toolCall.status === 'awaiting_approval',
      );

      if (restorableToolCalls.length > 0) {
        const checkpointDir = config.getProjectTempDir()
          ? path.join(config.getProjectTempDir(), 'checkpoints')
          : undefined;

        if (!checkpointDir) {
          return;
        }

        try {
          await fs.mkdir(checkpointDir, { recursive: true });
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'EEXIST') {
            onDebugMessage(
              `Failed to create checkpoint directory: ${getErrorMessage(error)}`,
            );
            return;
          }
        }

        for (const toolCall of restorableToolCalls) {
          const filePath = toolCall.request.args['file_path'] as string;
          if (!filePath) {
            onDebugMessage(
              `Skipping restorable tool call due to missing file_path: ${toolCall.request.name}`,
            );
            continue;
          }

          try {
            let commitHash = await gitService?.createFileSnapshot(
              `Snapshot for ${toolCall.request.name}`,
            );

            if (!commitHash) {
              commitHash = await gitService?.getCurrentCommitHash();
            }

            if (!commitHash) {
              onDebugMessage(
                `Failed to create snapshot for ${filePath}. Skipping restorable tool call.`,
              );
              continue;
            }

            const timestamp = new Date()
              .toISOString()
              .replace(/:/g, '-')
              .replace(/\./g, '_');
            const toolName = toolCall.request.name;
            const fileName = path.basename(filePath);
            const toolCallWithSnapshotFileName = `${timestamp}-${fileName}-${toolName}.json`;
            const clientHistory = chatSession.getHistory();
            const toolCallWithSnapshotFilePath = path.join(
              checkpointDir,
              toolCallWithSnapshotFileName,
            );

            await fs.writeFile(
              toolCallWithSnapshotFilePath,
              JSON.stringify(
                {
                  history,
                  clientHistory,
                  toolCall: {
                    name: toolCall.request.name,
                    args: toolCall.request.args,
                  },
                  commitHash,
                  filePath,
                },
                null,
                2,
              ),
            );
          } catch (error) {
            onDebugMessage(
              `Failed to write restorable tool call file: ${getErrorMessage(
                error,
              )}`,
            );
          }
        }
      }
    };
    saveRestorableToolCalls();
  }, [toolCalls, config, onDebugMessage, gitService, history, chatSession]);

  return {
    streamingState,
    streamState,
    streamStatus,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    eventBus, // Expose event bus for advanced usage
  };
};