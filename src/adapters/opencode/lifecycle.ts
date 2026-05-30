import type {
  CaptureRequest,
  CaptureResponse,
  SessionEndRequest,
  SessionEndResponse,
} from "../../gateway/types.js";
import {
  buildOpenCodeCapturePolicy,
  createFinalTurnIdempotencyKey,
  redactSensitiveText,
} from "./policy.js";

export interface OpenCodeLifecycleClient {
  capture(request: CaptureRequest): Promise<CaptureResponse>;
  endSession(request: SessionEndRequest): Promise<SessionEndResponse>;
}

export interface OpenCodeLifecycleLogger {
  warn?(message: string): void;
}

export interface OpenCodeFinalTurnEvent {
  sessionKey: string;
  sessionId?: string;
  userId?: string;
  turnIndex: number;
  userText: string;
  assistantText?: string;
  finalAssistantText?: string;
  hostSummary?: string | null;
  oversizedMessages?: readonly string[];
  final: boolean;
}

export interface OpenCodeSessionEndEvent {
  sessionKey: string;
  userId?: string;
}

export interface OpenCodeLifecycleControllerOptions {
  client: OpenCodeLifecycleClient;
  logger?: OpenCodeLifecycleLogger;
}

export function createOpenCodeLifecycleController(options: OpenCodeLifecycleControllerOptions) {
  const capturedFinalTurns = new Set<string>();
  const endedSessions = new Set<string>();

  return {
    async handleAssistantTurn(event: OpenCodeFinalTurnEvent): Promise<void> {
      if (!event.final) {
        return;
      }

      const assistantText = event.finalAssistantText ?? event.assistantText ?? "";
      const idempotencyKey = createFinalTurnIdempotencyKey({
        sessionKey: event.sessionKey,
        turnIndex: event.turnIndex,
        userText: event.userText,
        assistantText,
      });

      if (capturedFinalTurns.has(idempotencyKey)) {
        return;
      }

      capturedFinalTurns.add(idempotencyKey);

      const policy = buildOpenCodeCapturePolicy({
        userText: event.userText,
        assistantText,
        hostSummary: event.hostSummary,
        oversizedMessages: event.oversizedMessages,
      });
      const hostSummary = policy.capturedTexts[2];
      const messages = hostSummary ? [{ role: "host", content: hostSummary }] : undefined;

      try {
        await options.client.capture({
          user_content: policy.capturedTexts[0] ?? "",
          assistant_content: policy.capturedTexts[1] ?? "",
          session_key: event.sessionKey,
          session_id: event.sessionId,
          user_id: event.userId,
          messages,
        });
      } catch (error) {
        options.logger?.warn?.(
          redactSensitiveText(
            `OpenCode capture degraded for session_key=${event.sessionKey}: ${errorMessage(error)}`,
          ),
        );
      }
    },

    async handleSessionEnd(event: OpenCodeSessionEndEvent): Promise<void> {
      if (endedSessions.has(event.sessionKey)) {
        return;
      }

      endedSessions.add(event.sessionKey);

      try {
        await options.client.endSession({
          session_key: event.sessionKey,
          user_id: event.userId,
        });
      } catch (error) {
        options.logger?.warn?.(
          redactSensitiveText(
            `OpenCode session end degraded for session_key=${event.sessionKey}: ${errorMessage(error)}`,
          ),
        );
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
