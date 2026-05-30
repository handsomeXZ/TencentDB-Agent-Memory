import { describe, expect, it, vi } from "vitest";
import { GatewayHttpClient, type GatewayHttpClientOptions } from "./client.js";
import type {
  CaptureRequest,
  CaptureResponse,
  ConversationSearchRequest,
  ConversationSearchResponse,
  HealthResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  RecallRequest,
  RecallResponse,
  SessionEndRequest,
  SessionEndResponse,
} from "../gateway/types.js";

const API_KEY = "super-secret-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponseWithoutContentType(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function clientWith(fetchMock: typeof fetch, options: Partial<GatewayHttpClientOptions> = {}): GatewayHttpClient {
  return new GatewayHttpClient({
    baseUrl: "https://gateway.example/base/",
    apiKey: API_KEY,
    timeoutMs: 1_000,
    fetch: fetchMock,
    ...options,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function requestInit(init: RequestInit | undefined): RequestInit {
  expect(init).toBeDefined();
  return init as RequestInit;
}

function requestHeaders(init: RequestInit | undefined): Headers {
  return new Headers(requestInit(init).headers);
}

function expectNoRawToken(error: unknown): void {
  expect(String(error)).not.toContain(API_KEY);
  if (error instanceof Error) {
    expect(error.message).not.toContain(API_KEY);
    expect(error.stack ?? "").not.toContain(API_KEY);
  }
}

function protectedEndpointCalls(): Array<{
  name: string;
  call: (client: GatewayHttpClient) => Promise<unknown>;
  path: string;
  body: unknown;
  response: unknown;
}> {
  return [
    {
      name: "recall",
      path: "/recall",
      body: { query: "what happened", session_key: "s1", user_id: "u1" } satisfies RecallRequest,
      response: { context: "ctx", strategy: "hybrid", memory_count: 1 } satisfies RecallResponse,
      call: (client) => client.recall({ query: "what happened", session_key: "s1", user_id: "u1" }),
    },
    {
      name: "capture",
      path: "/capture",
      body: {
        user_content: "hello",
        assistant_content: "hi",
        session_key: "s1",
        session_id: "sid",
        user_id: "u1",
      } satisfies CaptureRequest,
      response: { l0_recorded: 1, scheduler_notified: true } satisfies CaptureResponse,
      call: (client) => client.capture({
        user_content: "hello",
        assistant_content: "hi",
        session_key: "s1",
        session_id: "sid",
        user_id: "u1",
      }),
    },
    {
      name: "searchMemories",
      path: "/search/memories",
      body: { query: "db", limit: 5, type: "episodic", scene: "coding" } satisfies MemorySearchRequest,
      response: { results: "memories", total: 1, strategy: "hybrid" } satisfies MemorySearchResponse,
      call: (client) => client.searchMemories({ query: "db", limit: 5, type: "episodic", scene: "coding" }),
    },
    {
      name: "searchConversations",
      path: "/search/conversations",
      body: { query: "db", limit: 5, session_key: "s1" } satisfies ConversationSearchRequest,
      response: { results: "conversations", total: 1 } satisfies ConversationSearchResponse,
      call: (client) => client.searchConversations({ query: "db", limit: 5, session_key: "s1" }),
    },
    {
      name: "endSession",
      path: "/session/end",
      body: { session_key: "s1", user_id: "u1" } satisfies SessionEndRequest,
      response: { flushed: true } satisfies SessionEndResponse,
      call: (client) => client.endSession({ session_key: "s1", user_id: "u1" }),
    },
  ];
}

async function expectRejectedWithoutToken(promise: Promise<unknown>, messagePattern: RegExp): Promise<void> {
  const result = await promise.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(String(result.error)).toMatch(messagePattern);
    expectNoRawToken(result.error);
  }
}

describe("GatewayHttpClient contract", () => {
  it("calls GET /health without Authorization", async () => {
    const body = {
      status: "ok",
      version: "0.1.0",
      uptime: 1,
      stores: { vectorStore: true, embeddingService: true },
    } satisfies HealthResponse;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));

    await expect(clientWith(fetchMock).health()).resolves.toEqual(body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    expect(requestUrl(input)).toBe("https://gateway.example/base/health");
    expect(requestInit(init).method).toBe("GET");
    expect(requestHeaders(init).has("authorization")).toBe(false);
  });

  it("sends Bearer auth and JSON DTO bodies to every protected Gateway endpoint", async () => {
    for (const contract of protectedEndpointCalls()) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(contract.response));

      await expect(contract.call(clientWith(fetchMock))).resolves.toEqual(contract.response);

      expect(fetchMock, contract.name).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0];
      const headers = requestHeaders(init);
      expect(requestUrl(input), contract.name).toBe(`https://gateway.example/base${contract.path}`);
      expect(requestInit(init).method, contract.name).toBe("POST");
      expect(headers.get("authorization"), contract.name).toBe(`Bearer ${API_KEY}`);
      expect(headers.get("content-type"), contract.name).toMatch(/application\/json/i);
      expect(JSON.parse(String(requestInit(init).body)), contract.name).toEqual(contract.body);
    }
  });

  it("normalizes a trailing slash in baseUrl without dropping nested base paths", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ context: "", memory_count: 0 }));

    await clientWith(fetchMock, { baseUrl: "https://gateway.example/root/" }).recall({
      query: "q",
      session_key: "s1",
    });

    expect(requestUrl(fetchMock.mock.calls[0][0])).toBe("https://gateway.example/root/recall");
  });

  it("fails fast before protected network requests when missing API key", async () => {
    for (const contract of protectedEndpointCalls()) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(contract.response));
      const client = clientWith(fetchMock, { apiKey: undefined });

      await expect(contract.call(client), contract.name).rejects.toThrow(/api key/i);

      expect(fetchMock, contract.name).not.toHaveBeenCalled();
    }
  });

  it("fails fast before protected network requests when API key is empty", async () => {
    for (const contract of protectedEndpointCalls()) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(contract.response));
      const client = clientWith(fetchMock, { apiKey: "   " });

      await expect(contract.call(client), contract.name).rejects.toThrow(/api key/i);

      expect(fetchMock, contract.name).not.toHaveBeenCalled();
    }
  });

  it("redacts the raw token from 401 errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: `Unauthorized: Bearer ${API_KEY}` }, 401),
    );

    await expectRejectedWithoutToken(
      clientWith(fetchMock).recall({ query: "q", session_key: "s1" }),
      /401|unauthorized/i,
    );
  });

  it("redacts the raw token from 403 auth errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: `Forbidden for Authorization: Bearer ${API_KEY}` }, 403),
    );

    await expectRejectedWithoutToken(
      clientWith(fetchMock).searchConversations({ query: "q", session_key: "s1" }),
      /403|forbidden/i,
    );
  });

  it("surfaces 429 rate limits as sanitized typed HTTP errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ error: `Rate limited for Bearer ${API_KEY}` }, 429));

    await expectRejectedWithoutToken(
      clientWith(fetchMock).searchMemories({ query: "q" }),
      /429|rate limited/i,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("redacts the raw token from 5xx errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "Gateway exploded" }, 503));

    await expectRejectedWithoutToken(
      clientWith(fetchMock).capture({
        user_content: "u",
        assistant_content: "a",
        session_key: "s1",
      }),
      /503|Gateway exploded/i,
    );
  });

  it("reports non-JSON Gateway responses without leaking the token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(textResponse("not json", 200));

    await expectRejectedWithoutToken(
      clientWith(fetchMock).searchMemories({ query: "q" }),
      /json|content-type/i,
    );
  });

  it("accepts parseable JSON responses even when Gateway omits content-type", async () => {
    const body = { results: "memories", total: 1, strategy: "hybrid" } satisfies MemorySearchResponse;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponseWithoutContentType(body));

    await expect(clientWith(fetchMock).searchMemories({ query: "q" })).resolves.toEqual(body);
  });

  it("retries transient read endpoint failures before returning a successful response", async () => {
    const body = { context: "ctx", strategy: "hybrid", memory_count: 1 } satisfies RecallResponse;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary gateway failure" }, 502))
      .mockResolvedValueOnce(jsonResponse(body));

    await expect(clientWith(fetchMock).recall({ query: "q", session_key: "s1" })).resolves.toEqual(body);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports malformed JSON Gateway responses without leaking the token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`{"error":"Bearer ${API_KEY}"`, {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expectRejectedWithoutToken(
      clientWith(fetchMock).recall({ query: "q", session_key: "s1" }),
      /json|parse/i,
    );
  });

  it("does not retry write endpoints on Gateway failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ error: "temporary failure" }, 503));

    await expectRejectedWithoutToken(
      clientWith(fetchMock).capture({ user_content: "u", assistant_content: "a", session_key: "s1" }),
      /503|temporary failure/i,
    );
    await expectRejectedWithoutToken(
      clientWith(fetchMock).endSession({ session_key: "s1" }),
      /503|temporary failure/i,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(fetchMock.mock.calls[0][0])).toBe("https://gateway.example/base/capture");
    expect(requestUrl(fetchMock.mock.calls[1][0])).toBe("https://gateway.example/base/session/end");
  });

  it("aborts requests that exceed timeoutMs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    try {
      const resultPromise = clientWith(fetchMock, { timeoutMs: 50 })
        .searchConversations({ query: "q" })
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      await vi.advanceTimersByTimeAsync(51);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(String(result.error)).toMatch(/timeout|timed out|abort/i);
        expectNoRawToken(result.error);
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
