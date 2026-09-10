import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { seasonStartUtc } from "./nfl-week";
import { validate, type PullResult } from "./claude-odds-validate";

export type { ProposedGame, PullResult } from "./claude-odds-validate";

const MODEL = "claude-opus-5";
/** Web search can pause a turn; each resume costs one. */
const MAX_TURNS = 8;
const MAX_SEARCHES = 8;

/**
 * The model reports its findings by calling this tool. We never execute it --
 * reading the arguments is the point. `strict` makes the API guarantee the
 * arguments match this schema, so the only checking left to do is whether the
 * values are plausible, which validateGames below handles.
 */
const RECORD_LINES_TOOL = {
  name: "record_lines",
  description:
    "Report the NFL games and point spreads you found. Call this exactly once, " +
    "after searching, with every game of the requested week.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      games: {
        type: "array",
        description: "Every game of the requested week that has a posted spread.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            away_team: {
              type: "string",
              description: "Full team name, e.g. Buffalo Bills.",
            },
            home_team: {
              type: "string",
              description: "Full team name, e.g. Kansas City Chiefs.",
            },
            kickoff_iso: {
              type: "string",
              description: "Kickoff as an ISO 8601 UTC timestamp, e.g. 2026-09-14T17:00:00Z.",
            },
            home_spread: {
              type: "number",
              description:
                "The spread from the HOME team's perspective. Negative means the " +
                "home team is favored: -3.5 means home favored by 3.5. Positive " +
                "means the home team is the underdog getting points. This is the " +
                "point spread, never the moneyline or the total.",
            },
          },
          required: ["away_team", "home_team", "kickoff_iso", "home_spread"],
        },
      },
      source: {
        type: "string",
        description: "Where the spreads came from, e.g. the sportsbook or site name.",
      },
    },
    required: ["games", "source"],
  },
};

function prompt(seasonYear: number, weekNumber: number): string {
  const weekStart = new Date(seasonStartUtc(seasonYear) + (weekNumber - 1) * 7 * 86_400_000);
  return [
    `Find the point spreads for week ${weekNumber} of the ${seasonYear} NFL season.`,
    `That week begins around ${weekStart.toISOString().slice(0, 10)}.`,
    "",
    "Search for current NFL odds, then report what you found by calling the",
    "record_lines tool exactly once.",
    "",
    "Rules that matter:",
    "- Report the POINT SPREAD, not the moneyline and not the over/under total.",
    "- Give the spread from the home team's perspective. If the home team is",
    "  favored by 3.5, home_spread is -3.5. If the home team is getting 3.5",
    "  points, home_spread is +3.5.",
    "- Use full team names exactly as the NFL writes them, e.g. Kansas City Chiefs.",
    "- Kickoff times must be UTC. US listings are usually Eastern, so convert.",
    "- Prefer one consistent sportsbook for every game so the numbers agree with",
    "  each other, and name it in the source field.",
    "- Omit a game entirely rather than guessing at a spread you could not find.",
    "- Do not include games from a different week.",
  ].join("\n");
}

/**
 * Asks Claude to search for the week's lines and report them.
 *
 * The numbers come back from a model reading a web page, so everything it
 * returns is treated as a proposal and checked before it can reach the
 * database. A returned row that fails a check is dropped and named, rather
 * than silently corrected.
 */
export async function pullLinesWithClaude(
  seasonYear: number,
  weekNumber: number,
): Promise<PullResult> {
  const empty: PullResult = { ok: false, error: null, games: [], rejected: [], source: null };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...empty, error: "No ANTHROPIC_API_KEY is set on this deployment." };
  }

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: prompt(seasonYear, weekNumber) },
  ];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // A policy decline would otherwise end the pull; this re-runs it on a
        // fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
          RECORD_LINES_TOOL,
        ],
        messages,
      });

      if (response.stop_reason === "refusal") {
        return { ...empty, error: "Claude declined the request." };
      }

      const call = response.content.find(
        (block): block is Anthropic.Beta.BetaToolUseBlock =>
          block.type === "tool_use" && block.name === "record_lines",
      );
      if (call) return validate(call.input, seasonYear, weekNumber);

      // A server tool ran out of its turn budget. Push the turn back to resume.
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      // It finished without reporting anything.
      if (response.stop_reason === "end_turn") {
        return {
          ...empty,
          error: "Claude searched but did not report any lines. Try again, or enter games by hand.",
        };
      }

      messages.push({ role: "assistant", content: response.content });
    }

    return { ...empty, error: "Gave up after too many turns without a result." };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ...empty, error: "The Anthropic API key was rejected." };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ...empty, error: "Rate limited by the Anthropic API. Try again shortly." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ...empty, error: `Anthropic API error ${error.status}: ${error.message}` };
    }
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}
