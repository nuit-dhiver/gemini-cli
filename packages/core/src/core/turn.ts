/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PartListUnion,
  GenerateContentResponse,
  FunctionCall,
  FunctionDeclaration,
  FinishReason,
} from '@google/genai';
import {
  ToolCallConfirmationDetails,
  ToolResult,
  ToolResultDisplay,
} from '../tools/tools.js';
import { ToolErrorType } from '../tools/tool-error.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { reportError } from '../utils/errorReporting.js';
import {
  getErrorMessage,
  UnauthorizedError,
  toFriendlyError,
} from '../utils/errors.js';
import { ChatSession } from './chatSession.js';

// Define a structure for tools passed to the server
export interface ServerTool {
  name: string;
  schema: FunctionDeclaration;
  // The execute method signature might differ slightly or be wrapped
  execute(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
  shouldConfirmExecute(
    params: Record<string, unknown>,
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false>;
}

export enum ChatEventType {
  Content = 'content',
  ToolCallRequest = 'tool_call_request',
  ToolCallResponse = 'tool_call_response',
  ToolCallConfirmation = 'tool_call_confirmation',
  UserCancelled = 'user_cancelled',
  Error = 'error',
  ChatCompressed = 'chat_compressed',
  Thought = 'thought',
  MaxSessionTurns = 'max_session_turns',
  Finished = 'finished',
  LoopDetected = 'loop_detected',
}

// Keep backward compatibility alias
export const GeminiEventType = ChatEventType;

export interface StructuredError {
  message: string;
  status?: number;
}

export interface GeminiErrorEventValue {
  error: StructuredError;
}

export interface ToolCallRequestInfo {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  isClientInitiated: boolean;
  prompt_id: string;
}

export interface ToolCallResponseInfo {
  callId: string;
  responseParts: PartListUnion;
  resultDisplay: ToolResultDisplay | undefined;
  error: Error | undefined;
  errorType: ToolErrorType | undefined;
}

export interface ServerToolCallConfirmationDetails {
  request: ToolCallRequestInfo;
  details: ToolCallConfirmationDetails;
}

export type ThoughtSummary = {
  subject: string;
  description: string;
};

export type ServerChatContentEvent = {
  type: ChatEventType.Content;
  value: string;
};

export type ServerChatThoughtEvent = {
  type: ChatEventType.Thought;
  value: ThoughtSummary;
};

export type ServerChatToolCallRequestEvent = {
  type: ChatEventType.ToolCallRequest;
  value: ToolCallRequestInfo;
};

export type ServerChatToolCallResponseEvent = {
  type: ChatEventType.ToolCallResponse;
  value: ToolCallResponseInfo;
};

export type ServerChatToolCallConfirmationEvent = {
  type: ChatEventType.ToolCallConfirmation;
  value: ServerToolCallConfirmationDetails;
};

export type ServerChatUserCancelledEvent = {
  type: ChatEventType.UserCancelled;
};

export type ServerChatErrorEvent = {
  type: ChatEventType.Error;
  value: GeminiErrorEventValue;
};

export interface ChatCompressionInfo {
  originalTokenCount: number;
  newTokenCount: number;
}

export type ServerChatCompressedEvent = {
  type: ChatEventType.ChatCompressed;
  value: ChatCompressionInfo | null;
};

export type ServerChatMaxSessionTurnsEvent = {
  type: ChatEventType.MaxSessionTurns;
};

export type ServerChatFinishedEvent = {
  type: ChatEventType.Finished;
  value: FinishReason;
};

export type ServerChatLoopDetectedEvent = {
  type: ChatEventType.LoopDetected;
};

// Provider-agnostic stream event type
export type ServerChatStreamEvent =
  | ServerChatContentEvent
  | ServerChatToolCallRequestEvent
  | ServerChatToolCallResponseEvent
  | ServerChatToolCallConfirmationEvent
  | ServerChatUserCancelledEvent
  | ServerChatErrorEvent
  | ServerChatCompressedEvent
  | ServerChatThoughtEvent
  | ServerChatMaxSessionTurnsEvent
  | ServerChatFinishedEvent
  | ServerChatLoopDetectedEvent;

// Keep backward compatibility aliases
export type ServerGeminiContentEvent = ServerChatContentEvent;
export type ServerGeminiThoughtEvent = ServerChatThoughtEvent;
export type ServerGeminiToolCallRequestEvent = ServerChatToolCallRequestEvent;
export type ServerGeminiToolCallResponseEvent = ServerChatToolCallResponseEvent;
export type ServerGeminiToolCallConfirmationEvent = ServerChatToolCallConfirmationEvent;
export type ServerGeminiUserCancelledEvent = ServerChatUserCancelledEvent;
export type ServerGeminiErrorEvent = ServerChatErrorEvent;
export type ServerGeminiChatCompressedEvent = ServerChatCompressedEvent;
export type ServerGeminiMaxSessionTurnsEvent = ServerChatMaxSessionTurnsEvent;
export type ServerGeminiFinishedEvent = ServerChatFinishedEvent;
export type ServerGeminiLoopDetectedEvent = ServerChatLoopDetectedEvent;
export type ServerGeminiStreamEvent = ServerChatStreamEvent;

// A turn manages the agentic loop turn within the server context.
export class Turn {
  readonly pendingToolCalls: ToolCallRequestInfo[];
  private debugResponses: GenerateContentResponse[];
  finishReason: FinishReason | undefined;

  constructor(
    private readonly chatSession: ChatSession,
    private readonly prompt_id: string,
  ) {
    this.pendingToolCalls = [];
    this.debugResponses = [];
    this.finishReason = undefined;
  }
  // The run method yields simpler events suitable for server logic
  async *run(
    req: PartListUnion,
    signal: AbortSignal,
  ): AsyncGenerator<ServerChatStreamEvent> {
    try {
      const responseStream = await this.chatSession.sendMessageStream(
        {
          message: Array.isArray(req) ? req : [req],
          config: {
            abortSignal: signal,
          },
        },
        this.prompt_id,
      );

      for await (const resp of responseStream) {
        if (signal?.aborted) {
          yield { type: ChatEventType.UserCancelled };
          // Do not add resp to debugResponses if aborted before processing
          return;
        }
        this.debugResponses.push(resp);

        const thoughtPart = resp.candidates?.[0]?.content?.parts?.[0];
        if (thoughtPart?.thought) {
          // Thought always has a bold "subject" part enclosed in double asterisks
          // (e.g., **Subject**). The rest of the string is considered the description.
          const rawText = thoughtPart.text ?? '';
          const subjectStringMatches = rawText.match(/\*\*(.*?)\*\*/s);
          const subject = subjectStringMatches
            ? subjectStringMatches[1].trim()
            : '';
          const description = rawText.replace(/\*\*(.*?)\*\*/s, '').trim();
          const thought: ThoughtSummary = {
            subject,
            description,
          };

          yield {
            type: ChatEventType.Thought,
            value: thought,
          };
          continue;
        }

        const text = getResponseText(resp);
        if (text) {
          yield { type: ChatEventType.Content, value: text };
        }

        // Handle function calls (requesting tool execution)
        const functionCalls = resp.functionCalls ?? [];
        for (const fnCall of functionCalls) {
          const event = this.handlePendingFunctionCall(fnCall);
          if (event) {
            yield event;
          }
        }

        // Check if response was truncated or stopped for various reasons
        const finishReason = resp.candidates?.[0]?.finishReason;

        if (finishReason) {
          this.finishReason = finishReason;
          yield {
            type: ChatEventType.Finished,
            value: finishReason as FinishReason,
          };
        }
      }
    } catch (e) {
      const error = toFriendlyError(e);
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      if (signal.aborted) {
        yield { type: ChatEventType.UserCancelled };
        // Regular cancellation error, fail gracefully.
        return;
      }

      const contextForReport = [...this.chatSession.getHistory(/*curated*/ true), req];
      await reportError(
        error,
        `Error when talking to ${this.chatSession.provider} API`,
        contextForReport,
        'Turn.run-sendMessageStream',
      );
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof (error as { status: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined;
      const structuredError: StructuredError = {
        message: getErrorMessage(error),
        status,
      };
      yield { type: ChatEventType.Error, value: { error: structuredError } };
      return;
    }
  }

  private handlePendingFunctionCall(
    fnCall: FunctionCall,
  ): ServerChatStreamEvent | null {
    const callId =
      fnCall.id ??
      `${fnCall.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const name = fnCall.name || 'undefined_tool_name';
    const args = (fnCall.args || {}) as Record<string, unknown>;

    const toolCallRequest: ToolCallRequestInfo = {
      callId,
      name,
      args,
      isClientInitiated: false,
      prompt_id: this.prompt_id,
    };

    this.pendingToolCalls.push(toolCallRequest);

    // Yield a request for the tool call, not the pending/confirming status
    return { type: ChatEventType.ToolCallRequest, value: toolCallRequest };
  }

  getDebugResponses(): GenerateContentResponse[] {
    return this.debugResponses;
  }
}
