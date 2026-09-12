import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { readPoll, type PollEntry } from "./rankings";

/**
 * Fetching the AP Top 25 with a model, when nobody has pasted one in.
 *
 * This used to run on every college pull, which is why an NCAA pull was slow
 * and expensive while the NFL's was instant: web search results land in the
 * context, and a paused turn resends the lot. It is now a deliberate act that
 * happens at most once a week, and it is bounded so that once costs little:
 *
 * - one search, not eight, so only one set of results is ever in context
 * - low effort and a small output cap, since this is transcription
 * - one resume at most, because a resume resends everything
 *
 * The usage is returned so the admin panel can print what a pull cost rather
 * than leaving anyone to guess.
 */

const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";
const MAX_SEARCHES = 1;
const MAX_TURNS = 2;

export type PollFetch = {
  entries: PollEntry[];
  error: string | null;
  /** Tokens this cost, so it can be shown rather than guessed at. */
  inputTokens: number;
  outputTokens: number;
};

const RECORD_POLL_TOOL = {
  name: "record_rankings",
  description: "Report the AP Top 25 you found. Call this exactly once.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      rankings: {
        type: "array",
        description: "The twenty-five ranked schools, best first.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            rank: { type: "integer", description: "Position, 1 through 25." },
            team: {
              type: "string",
              description: "School name only, without the nickname: Ohio State, Texas A&M.",
            },
          },
          required: ["rank", "team"],
        },
      },
    },
    required: ["rankings"],
  },
};

export async function fetchApTop25(
  seasonYear: number,
  weekNumber: number,
): Promise<PollFetch> {
  const empty: PollFetch = { entries: [], error: null, inputTokens: 0, outputTokens: 0 };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...empty, error: "No ANTHROPIC_API_KEY is set on this deployment." };
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Search once for the AP Top 25 college football poll for week ${weekNumber} ` +
        `of the ${seasonYear} season, then call record_rankings with it. School names ` +
        "only, as the poll writes them: no nicknames, no records, no vote totals.",
    },
  ];

  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        output_config: { effort: "low" },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
          RECORD_POLL_TOOL,
        ],
        messages,
      });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const call = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === "record_rankings",
      );
      if (call) {
        return { entries: readPoll(call.input), error: null, inputTokens, outputTokens };
      }

      if (response.stop_reason === "pause_turn" && turn < MAX_TURNS - 1) {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      break;
    }

    return {
      ...empty,
      inputTokens,
      outputTokens,
      error: "The search did not come back with a poll. Paste one in instead.",
    };
  } catch (error) {
    const message =
      error instanceof Anthropic.APIError
        ? `Anthropic API error ${error.status}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return { ...empty, inputTokens, outputTokens, error: message };
  }
}
