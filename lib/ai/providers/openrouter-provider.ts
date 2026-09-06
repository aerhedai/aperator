import type {
  AIMessage,
  AIProvider,
  AIResponse,
  AIToolCallRequest,
  GenerateRequest,
} from "@/lib/ai/provider";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenRouterChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function toOpenRouterMessage(message: AIMessage) {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls && {
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        // OpenAI-compatible APIs (OpenRouter included) require arguments
        // as a JSON *string* here — the opposite direction from the
        // response side below, where they arrive as a string and get
        // parsed. Confirmed against OpenRouter's own docs, not assumed
        // from Ollama's shape, which passes arguments as an object both
        // ways.
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    }),
    ...(message.toolCallId && { tool_call_id: message.toolCallId }),
  };
}

function fromOpenRouterToolCalls(
  calls: OpenRouterToolCall[] | undefined,
): AIToolCallRequest[] | undefined {
  if (!calls || calls.length === 0) return undefined;

  return calls.map((call) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // A model that returns malformed JSON for its own tool call is a
      // real failure, but not one worth crashing the whole response
      // over — the tool call still surfaces with empty arguments, and
      // whichever tool it names will reject it as a normal invalid-input
      // tool error instead of an opaque provider crash.
    }
    return { id: call.id, name: call.function.name, arguments: args };
  });
}

/**
 * OpenRouter's chat completions API — OpenAI-compatible, confirmed against
 * OpenRouter's own docs. Deliberately no separate mapping module the way
 * Gemini needed one: AIMessage's shape (role/content, toolCalls with
 * id/name/arguments, tool role with toolCallId) already corresponds almost
 * field-for-field with OpenAI's, unlike Gemini's genuinely different wire
 * format. The one real difference from Ollama's own near-identical shape:
 * tool call arguments travel as a JSON *string* in both directions here,
 * not an object — get that backwards and every tool call silently breaks.
 *
 * No generateEmbedding: OpenRouter is a chat-completions gateway, not an
 * embeddings provider for the models routed through it. Same reasoning as
 * GeminiProvider — AIProvider already treats this as optional for exactly
 * this situation.
 */
export class OpenRouterProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async generateResponse(request: GenerateRequest): Promise<AIResponse> {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(toOpenRouterMessage),
        ...(request.tools && {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }),
        ...(request.responseFormat === "json" && {
          response_format: { type: "json_object" },
        }),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenRouter request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as OpenRouterChatResponse;
    const message = data.choices[0]?.message;
    if (!message) {
      throw new Error("OpenRouter returned no choices for this request.");
    }

    return {
      content: message.content ?? "",
      toolCalls: fromOpenRouterToolCalls(message.tool_calls),
      ...(data.usage && {
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
        },
      }),
    };
  }
}
