import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { readPoll, type PollEntry } from "./rankings";

/**
 * The AP Top 25, fetched once per pull.
 *
 * This is all that is left of asking a model about college football. The games
 * and the spreads now come from the odds feed, where the names are exact and
 * nothing can be invented; a poll is the one thing the feed does not carry.
 * Asking for twenty-five school names costs a fraction of asking for twenty
 * games with lines and kickoff times, and if it fails the pull still works --
 * the games simply arrive without rankings beside them.
 */

const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";
const MAX_TURNS = 4;
const MAX_SEARCHES = 3;

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

/** The current AP Top 25, or an empty list if it could not be fetched. */
export async function fetchApTop25(seasonYear: number, weekNumber: number): Promise<PollEntry[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        `Find the current AP Top 25 college football poll for week ${weekNumber}`,
        `of the ${seasonYear} season, then call record_rankings once with it.`,
        "Give the school name only, as the poll writes it, with no nickname and",
        "no ranking number inside the name.",
      ].join(" "),
    },
  ];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
          RECORD_POLL_TOOL,
        ],
        messages,
      });

      const call = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === "record_rankings",
      );
      if (call) return readPoll(call.input);

      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      return [];
    }
    return [];
  } catch {
    // Rankings are decoration. A failure here must not cost anyone their slate.
    return [];
  }
}
