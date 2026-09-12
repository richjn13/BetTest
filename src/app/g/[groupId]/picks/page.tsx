import { requireViewer } from "@/lib/auth";
import {
  getCurrentWeek,
  getWeekBoard,
  listPickableWeeks,
  sportsWithOpenWeeks,
} from "@/lib/queries";
import { refreshScoresIfStale } from "@/lib/live";
import { isSport, sportLabel, type Sport } from "@/lib/sports";
import { PicksView, type Scope } from "./PicksView";
import { PicksBoard } from "./PicksBoard";
import { WeekNotice } from "./WeekNotice";
import { WeekSummary } from "./WeekSummary";
import { WeekTabs } from "./WeekTabs";

export const dynamic = "force-dynamic";

/**
 * College first, then the NFL. That is the order the weekend happens in and
 * the order the tabs are in, so it is the order All stacks them.
 */
const DISPLAY_ORDER: Sport[] = ["ncaaf", "nfl"];

export default async function PicksPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { week?: string; sport?: string };
}) {
  const { user } = await requireViewer(params.groupId);

  // Bring scores current before rendering, if a game is under way and nobody
  // has checked recently. Costs nothing when no game is live, and one call
  // however many people are watching.
  const live = await refreshScoresIfStale();

  const open = await sportsWithOpenWeeks();
  const sports = DISPLAY_ORDER.filter((sport) => open.includes(sport));

  if (sports.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-medium">No week is open.</p>
        <p className="mt-1 text-sm text-muted">
          An admin opens a week by pulling its games from the Admin tab. Closed
          weeks come off this page, but their points stay on the leaderboard.
        </p>
      </div>
    );
  }

  const requested = searchParams.sport;
  const scope: Scope =
    requested === "all" && sports.length > 1
      ? "all"
      : isSport(requested) && sports.includes(requested)
        ? requested
        : (sports[0] ?? "nfl");

  // Every competition is loaded, whichever tab is showing. The All view needed
  // both anyway, and having both here is what lets the tabs switch without
  // going back to the server.
  const sections = await Promise.all(
    sports.map(async (sport) => {
      const weeks = await listPickableWeeks(sport);

      // A week chosen from the week tabs only applies to its own competition.
      const chosen = searchParams.week
        ? weeks.find((entry) => entry.id === searchParams.week)
        : undefined;
      const week = chosen ?? (await getCurrentWeek(sport));

      if (!week) {
        return {
          sport,
          content: (
            <div className="card p-6 text-center">
              <p className="text-sm font-medium">No {sportLabel(sport)} week is open.</p>
            </div>
          ),
        };
      }

      const board = await getWeekBoard(params.groupId, user.id, week.id);
      const label = `${sportLabel(sport)} ${week.label}`;

      return {
        sport,
        content: (
          <>
            <WeekTabs
              weeks={weeks}
              currentWeekId={week.id}
              basePath={`/g/${params.groupId}/picks?sport=${sport}`}
            />
            <WeekNotice week={week} cards={board} />
            {board.length > 0 && <WeekSummary cards={board} weekLabel={label} />}
            {board.length === 0 ? (
              <p className="card p-6 text-center text-sm text-muted">
                No games in {week.label} yet.
              </p>
            ) : (
              <PicksBoard
                // Keyed by week so switching weeks builds a fresh board rather
                // than carrying the previous week's picks into it.
                key={week.id}
                cards={board}
                groupId={params.groupId}
                weekLabel={label}
                readOnly={false}
                sport={sport}
              />
            )}
          </>
        ),
      };
    }),
  );

  return (
    <div>
      <ScoreClock live={live} />
      <PicksView sports={sports} initial={scope} sections={sections} />
    </div>
  );
}

/**
 * When the scores were last brought current. Only there once something has
 * been checked, so it reassures rather than clutters.
 */
function ScoreClock({ live }: { live: { ran: string[]; lastChecked: Date | null } }) {
  if (live.lastChecked === null) return null;

  const minutes = Math.floor((Date.now() - live.lastChecked.getTime()) / 60_000);
  const when =
    live.ran.length > 0 || minutes <= 0
      ? "just now"
      : minutes === 1
        ? "a minute ago"
        : `${minutes} minutes ago`;

  return (
    <p className="mb-3 text-xs text-muted">
      Scores checked {when}. They refresh while you watch.
    </p>
  );
}
