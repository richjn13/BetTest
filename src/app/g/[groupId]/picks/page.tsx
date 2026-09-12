import { requireViewer } from "@/lib/auth";
import {
  getCurrentWeek,
  getWeekBoard,
  listPickableWeeks,
  sportsWithOpenWeeks,
} from "@/lib/queries";
import { isSport, sportLabel, type Sport } from "@/lib/sports";
import { SportTabs, type Scope } from "./SportTabs";
import { PicksBoard } from "./PicksBoard";
import { WeekNotice } from "./WeekNotice";
import { WeekSummary } from "./WeekSummary";
import { WeekTabs } from "./WeekTabs";

export const dynamic = "force-dynamic";

/**
 * College first, then the NFL. That is the order the weekend happens in and
 * the order the tabs are in, so it is the order the All view stacks them.
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

  const open = await sportsWithOpenWeeks();
  const sports = DISPLAY_ORDER.filter((sport) => open.includes(sport));
  const basePath = `/g/${params.groupId}/picks`;

  // College is the default when it has a week open, since its weekend comes
  // first. "all" is a deliberate choice rather than the landing place.
  const requested = searchParams.sport;
  const scope: Scope =
    requested === "all" && sports.length > 1
      ? "all"
      : isSport(requested) && sports.includes(requested)
        ? requested
        : (sports[0] ?? "nfl");

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

  // Both competitions at once: each keeps its own board, its own counts and its
  // own lock, because they are separate weeks with separate rules. Stacking
  // them is what makes one scroll of a Saturday and a Sunday possible.
  if (scope === "all") {
    const boards = await Promise.all(
      sports.map(async (sport) => {
        const week = await getCurrentWeek(sport);
        if (!week) return null;
        return { sport, week, cards: await getWeekBoard(params.groupId, user.id, week.id) };
      }),
    );

    return (
      <div>
        <SportTabs sports={sports} current={scope} basePath={basePath} />

        <div className="space-y-8">
          {boards.map((board, index) =>
            board === null ? null : (
              <section key={board.sport} className="space-y-3">
                {/* A labelled rule between the two, so a long scroll never
                    leaves you unsure which competition you are looking at. */}
                {index > 0 && (
                  <div className="flex items-center gap-3 pt-2">
                    <span className="h-px flex-1 bg-edge" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                      {sportLabel(board.sport)}
                    </span>
                    <span className="h-px flex-1 bg-edge" />
                  </div>
                )}
                <WeekNotice week={board.week} cards={board.cards} />
                {board.cards.length === 0 ? (
                  <p className="card p-6 text-center text-sm text-muted">
                    No games in {sportLabel(board.sport)} {board.week.label} yet.
                  </p>
                ) : (
                  <PicksBoard
                    key={board.week.id}
                    cards={board.cards}
                    groupId={params.groupId}
                    weekLabel={`${sportLabel(board.sport)} ${board.week.label}`}
                    readOnly={false}
                    sport={board.sport}
                  />
                )}
              </section>
            ),
          )}
        </div>
      </div>
    );
  }

  const sport = scope;

  // Only weeks that are open: pulled, and not yet closed. An unpulled week does
  // not exist yet as far as members are concerned, and a closed one is finished
  // and comes off the app. Its points stay on the leaderboard.
  const weeks = await listPickableWeeks(sport);
  const chosen = searchParams.week
    ? weeks.find((week) => week.id === searchParams.week)
    : undefined;
  const week = chosen ?? (await getCurrentWeek(sport));

  if (!week) {
    return (
      <div>
        <SportTabs sports={sports} current={scope} basePath={basePath} />
        <div className="card p-6 text-center">
          <p className="text-sm font-medium">No {sportLabel(sport)} week is open.</p>
          <p className="mt-1 text-sm text-muted">
            An admin opens a week by pulling its games from the Admin tab.
          </p>
        </div>
      </div>
    );
  }

  const board = await getWeekBoard(params.groupId, user.id, week.id);

  return (
    <div>
      <SportTabs sports={sports} current={scope} basePath={basePath} />

      <WeekTabs
        weeks={weeks}
        currentWeekId={week.id}
        basePath={`${basePath}?sport=${sport}`}
      />

      <WeekNotice week={week} cards={board} />

      {board.length > 0 && (
        <WeekSummary cards={board} weekLabel={`${sportLabel(sport)} ${week.label}`} />
      )}

      {board.length === 0 ? (
        <p className="card p-6 text-center text-sm text-muted">
          No games in {week.label} yet.
        </p>
      ) : (
        <PicksBoard
          // Keyed by week so switching weeks builds a fresh board rather than
          // carrying the previous week's picks into it.
          key={week.id}
          cards={board}
          groupId={params.groupId}
          weekLabel={`${sportLabel(sport)} ${week.label}`}
          readOnly={false}
          sport={sport}
        />
      )}
    </div>
  );
}
