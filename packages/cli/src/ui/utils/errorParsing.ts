/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, StructuredError } from '@google/gemini-cli-core';

const RATE_LIMIT_ERROR_MESSAGE_GOOGLE =
  '\nPlease wait and try again later. To increase your limits, upgrade to a plan with higher limits, or use /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey';
const RATE_LIMIT_ERROR_MESSAGE_USE_GEMINI =
  '\nPlease wait and try again later. To increase your limits, request a quota increase through AI Studio, or switch to another /auth method';
const RATE_LIMIT_ERROR_MESSAGE_VERTEX =
  '\nPlease wait and try again later. To increase your limits, request a quota increase through Vertex, or switch to another /auth method';
const RATE_LIMIT_ERROR_MESSAGE_DEFAULT =
  'Your request has been rate limited. Please wait and try again later.';

export interface ApiError {
  error: {
    code: number;
    message: string;
    status: string;
    details: unknown[];
  };
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof (error as ApiError).error === 'object' &&
    'message' in (error as ApiError).error
  );
}

function isStructuredError(error: unknown): error is StructuredError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as StructuredError).message === 'string'
  );
}

function getRateLimitMessage(authType?: AuthType): string {
  switch (authType) {
    case AuthType.LOGIN_WITH_GOOGLE:
      return RATE_LIMIT_ERROR_MESSAGE_GOOGLE;
    case AuthType.USE_GEMINI:
      return RATE_LIMIT_ERROR_MESSAGE_USE_GEMINI;
    case AuthType.USE_VERTEX_AI:
      return RATE_LIMIT_ERROR_MESSAGE_VERTEX;
    default:
      return RATE_LIMIT_ERROR_MESSAGE_DEFAULT;
  }
}

export function parseAndFormatApiError(
  error: unknown,
  authType?: AuthType,
): string {
  // Detect Google account age verification errors
  const ageVerificationPatterns = [
    /age verification/i,
    /not eligible/i,
    /account.*age.*require/i,
    /age.*require.*google/i,
    /age.*restriction/i,
    /age.*verify/i,
    /must be.*years old/i,
    /parental consent/i,
  ];
  const AGE_VERIFICATION_MESSAGE =
    'You must pass age verification for your Google account. See https://support.google.com/accounts/answer/13504020';

  // Check string errors for age verification
  if (typeof error === 'string') {
    for (const pattern of ageVerificationPatterns) {
      if (pattern.test(error)) {
        return AGE_VERIFICATION_MESSAGE;
      }
    }
  }

  // Check structured errors for age verification
  if (isStructuredError(error) && typeof error.message === 'string') {
    for (const pattern of ageVerificationPatterns) {
      if (pattern.test(error.message)) {
        return AGE_VERIFICATION_MESSAGE;
      }
    }
  }

  if (isStructuredError(error)) {
    let text = `[API Error: ${error.message}]`;
    if (error.status === 429) {
      text += getRateLimitMessage(authType);
    }
    return text;
  }

  // The error message might be a string containing a JSON object.
  if (typeof error === 'string') {
    const jsonStart = error.indexOf('{');
    if (jsonStart === -1) {
      return `[API Error: ${error}]`; // Not a JSON error, return as is.
    }

    const jsonString = error.substring(jsonStart);

    try {
      const parsedError = JSON.parse(jsonString) as unknown;
      if (isApiError(parsedError)) {
        let finalMessage = parsedError.error.message;
        // Check for age verification in parsed error message
        for (const pattern of ageVerificationPatterns) {
          if (pattern.test(finalMessage)) {
            return AGE_VERIFICATION_MESSAGE;
          }
        }
        try {
          // See if the message is a stringified JSON with another error
          const nestedError = JSON.parse(finalMessage) as unknown;
          if (isApiError(nestedError)) {
            finalMessage = nestedError.error.message;
          }
        } catch (_e) {
          // It's not a nested JSON error, so we just use the message as is.
        }
        let text = `[API Error: ${finalMessage} (Status: ${parsedError.error.status})]`;
        if (parsedError.error.code === 429) {
          text += getRateLimitMessage(authType);
        }
        return text;
      }
    } catch (_e) {
      // Not a valid JSON, fall through and return the original message.
    }
    return `[API Error: ${error}]`;
  }

  return '[API Error: An unknown error occurred.]';
}
