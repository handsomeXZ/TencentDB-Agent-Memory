import type {
  ConversationSearchRequest,
  ConversationSearchResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  RecallRequest,
  RecallResponse,
} from "../../gateway/types.js";
import { OPEN_CODE_PLUGIN_DEFAULTS } from "./config.js";
import { redactSensitiveText } from "./policy.js";

export interface OpenCodeToolContext {
  sessionKey: string;
}

export interface OpenCodeRecallArgs {
  query: string;
}

export interface OpenCodeSearchArgs {
  query: string;
  limit?: number;
}

export interface OpenCodeToolDefinition<TArgs> {
  name: string;
  description: string;
  execute: (args: TArgs) => Promise<string>;
}

export interface OpenCodeToolsClient {
  recall(request: RecallRequest): Promise<RecallResponse>;
  searchMemories(request: MemorySearchRequest): Promise<MemorySearchResponse>;
  searchConversations(request: ConversationSearchRequest): Promise<ConversationSearchResponse>;
}

export interface CreateOpenCodeToolsOptions {
  client: OpenCodeToolsClient;
  context: OpenCodeToolContext;
  recallMaxTotalChars?: number;
}

const DEFAULT_LIMIT = OPEN_CODE_PLUGIN_DEFAULTS.recallMaxResults;
const DEFAULT_RECALL_MAX_TOTAL_CHARS = OPEN_CODE_PLUGIN_DEFAULTS.recallMaxTotalChars;

export function createOpenCodeTools(
  options: CreateOpenCodeToolsOptions,
): Array<OpenCodeToolDefinition<OpenCodeRecallArgs | OpenCodeSearchArgs>> {
  const recallMaxTotalChars =
    options.recallMaxTotalChars ?? DEFAULT_RECALL_MAX_TOTAL_CHARS;

  return [
    {
      name: "tdai_memory_recall",
      description: "Recall scoped TencentDB memories for the current OpenCode session.",
      execute: async (args) => {
        const query = normalizeQuery(args.query);
        if (!query) {
          return "Please provide a non-empty memory recall query.";
        }

        try {
          const response = await options.client.recall({
            query,
            session_key: options.context.sessionKey,
          });

          return formatRecallResponse(response, recallMaxTotalChars);
        } catch (error) {
          return formatGatewayError(
            "Memory recall is temporarily unavailable.",
            error,
            recallMaxTotalChars,
          );
        }
      },
    },
    {
      name: "tdai_memory_search",
      description: "Search long-term TencentDB memories across the current workspace scope.",
      execute: async (args) => {
        const query = normalizeQuery(args.query);
        if (!query) {
          return "Please provide a non-empty memory search query.";
        }

        try {
          const response = await options.client.searchMemories({
            query,
            limit: normalizeLimit(args.limit),
          });

          return formatSearchBlock({
            title: `Memory search (${response.strategy})`,
            body: response.results,
            emptyMessage: "No matching memories found.",
            maxChars: recallMaxTotalChars,
          });
        } catch (error) {
          return formatGatewayError(
            "Memory search is temporarily unavailable.",
            error,
            recallMaxTotalChars,
          );
        }
      },
    },
    {
      name: "tdai_conversation_search",
      description: "Search prior conversation snippets within the current scoped OpenCode session.",
      execute: async (args) => {
        const query = normalizeQuery(args.query);
        if (!query) {
          return "Please provide a non-empty conversation search query.";
        }

        try {
          const response = await options.client.searchConversations({
            query,
            limit: normalizeLimit(args.limit),
            session_key: options.context.sessionKey,
          });

          return formatSearchBlock({
            title: "Conversation search",
            body: response.results,
            emptyMessage: "No matching conversation messages found.",
            maxChars: recallMaxTotalChars,
          });
        } catch (error) {
          return formatGatewayError(
            "Conversation search is temporarily unavailable.",
            error,
            recallMaxTotalChars,
          );
        }
      },
    },
  ];
}

export function getOpenCodeV1ToolNames(): string[] {
  return ["tdai_memory_recall", "tdai_memory_search", "tdai_conversation_search"];
}

function normalizeQuery(value: string): string {
  return value.trim();
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.floor(value);
}

function formatRecallResponse(response: RecallResponse, maxTotalChars: number): string {
  const context = truncateText(redactSensitiveText(response.context ?? "").trim(), maxTotalChars);
  if (!context) {
    return "No relevant memory recall found for this session.";
  }

  const lines = [
    `Memory recall (${response.strategy ?? "unknown"})`,
    `Sources: ${response.memory_count ?? 0}`,
    "",
    context,
  ];
  return lines.join("\n");
}

function formatSearchBlock(input: { title: string; body: string; emptyMessage: string; maxChars: number }): string {
  const body = truncateText(redactSensitiveText(input.body ?? "").trim(), input.maxChars);
  if (!body) {
    return input.emptyMessage;
  }

  return [input.title, "", body].join("\n");
}

function formatGatewayError(summary: string, error: unknown, maxChars: number): string {
  const detail = truncateText(
    redactSensitiveText(error instanceof Error ? error.message : String(error)).trim(),
    maxChars,
  );

  if (!detail) {
    return summary;
  }

  return [summary, "", detail].join("\n");
}

function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 12)).trimEnd()}\n[truncated]`;
}
