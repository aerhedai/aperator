import type {
  AIMessage,
  AIToolCallRequest,
  AIToolDefinition,
} from "@/lib/ai/provider";

/**
 * Translates between this app's flat, OpenAI/Ollama-shaped message list and
 * Gemini's generateContent wire format.
 *
 * Pulled out as pure functions, not inlined in GeminiProvider, because the
 * wire format is genuinely different in three ways that are each easy to
 * get subtly wrong, and each is worth its own test:
 *
 * 1. Gemini has no "system" role — a system message becomes a separate
 *    `systemInstruction` field, outside `contents`.
 * 2. Gemini has no "tool" role either. A tool's result goes back as a
 *    `role: "user"` turn containing a `functionResponse` part — confirmed
 *    against Google's own documented curl example, not assumed from an
 *    OpenAI-style convention.
 * 3. `functionResponse` requires the function's *name*, but AIMessage's
 *    tool-role entries only carry `toolCallId` (see agent-runtime.ts,
 *    where a tool result is pushed as `{role: "tool", toolCallId: call.id}`
 *    with no name — the id was always enough to pair a result back to its
 *    request for Ollama's OpenAI-style format, so the name was never
 *    threaded through). Recovered here by remembering each call's name
 *    from the assistant turn that proposed it, the only place it exists.
 */

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiRequestContents {
  systemInstruction?: { parts: [{ text: string }] };
  contents: GeminiContent[];
}

/**
 * A tool's result content is `JSON.stringify`'d by the caller (see
 * tool-result.ts's toolSuccess/toolError) before it ever reaches here.
 * Gemini's functionResponse.response must be a JSON *object* — a bare
 * string, number, or array is wrapped under a "result" key instead of
 * being sent as-is, since the API would otherwise reject it.
 */
function toFunctionResponseBody(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

export function toGeminiContents(messages: AIMessage[]): GeminiRequestContents {
  const systemParts: string[] = [];
  const callNameById = new Map<string, string>();
  const contents: GeminiContent[] = [];
  // Consecutive tool-result messages (every result from one assistant turn
  // that made several tool calls) are batched into a single role:"user"
  // turn with multiple functionResponse parts, matching Gemini's own
  // documented parallel-function-calling pattern, rather than one turn per
  // result.
  let pendingFunctionResponses: GeminiPart[] = [];

  function flushPending() {
    if (pendingFunctionResponses.length === 0) return;
    contents.push({ role: "user", parts: pendingFunctionResponses });
    pendingFunctionResponses = [];
  }

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push(message.content);
      continue;
    }

    if (message.role === "tool") {
      const name = message.toolCallId
        ? (callNameById.get(message.toolCallId) ?? "unknown_function")
        : "unknown_function";
      pendingFunctionResponses.push({
        functionResponse: {
          name,
          response: toFunctionResponseBody(message.content),
        },
      });
      continue;
    }

    flushPending();

    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }

    // role === "assistant"
    const parts: GeminiPart[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls ?? []) {
      callNameById.set(call.id, call.name);
      parts.push({
        functionCall: { name: call.name, args: call.arguments },
      });
    }
    contents.push({ role: "model", parts });
  }
  flushPending();

  return {
    ...(systemParts.length > 0 && {
      systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] },
    }),
    contents,
  };
}

export function toGeminiTools(
  tools: AIToolDefinition[] | undefined,
): [{ functionDeclarations: AIToolDefinition[] }] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

export interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  // Present instead of candidates when the prompt itself was blocked
  // (safety filters) before any generation happened.
  promptFeedback?: { blockReason?: string };
}

/**
 * Raised for a response Gemini returned successfully at the HTTP level but
 * that carries no usable content — a blocked prompt, or a response with no
 * candidates. Kept distinct from a network/HTTP error so callers can tell
 * "the request never landed" from "it landed and was refused."
 */
export class GeminiEmptyResponseError extends Error {}

/**
 * Synthesizes a call id the same way OllamaProvider does
 * (`fromOllamaToolCalls`): Gemini's response, like Ollama's, never returns
 * an id for a function call — it identifies calls by name/args within the
 * turn alone. An index-based id is stable within one response, which is
 * all a caller needs to pair a result back to its request.
 */
export function fromGeminiResponse(data: GeminiGenerateContentResponse): {
  content: string;
  toolCalls?: AIToolCallRequest[];
  usage?: { promptTokens: number; completionTokens: number };
} {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    const blockReason = data.promptFeedback?.blockReason;
    throw new GeminiEmptyResponseError(
      blockReason
        ? `Gemini blocked this request (${blockReason}).`
        : "Gemini returned no candidates for this request.",
    );
  }

  const parts = candidate.content?.parts ?? [];
  const content = parts
    .filter((p): p is { text: string } => typeof p.text === "string")
    .map((p) => p.text)
    .join("");

  const functionCallParts = parts.filter((p) => p.functionCall);
  const toolCalls: AIToolCallRequest[] | undefined =
    functionCallParts.length > 0
      ? functionCallParts.map((p, index) => ({
          id: `call_${index}`,
          name: p.functionCall!.name,
          arguments: p.functionCall!.args,
        }))
      : undefined;

  const hasUsage =
    typeof data.usageMetadata?.promptTokenCount === "number" &&
    typeof data.usageMetadata?.candidatesTokenCount === "number";

  return {
    content,
    toolCalls,
    ...(hasUsage && {
      usage: {
        promptTokens: data.usageMetadata!.promptTokenCount!,
        completionTokens: data.usageMetadata!.candidatesTokenCount!,
      },
    }),
  };
}
