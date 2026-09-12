import { requireViewer } from "@/lib/auth";
import {
  getCurrentWeek,
  getWeekBoard,
  listPickableWeeks,
  sportsWithOpenWeeks,
} from "@/lib/queries";
import { isSport, sportLabel, type Sport } from "@/lib/sports";
import { SportTabs } from "./SportTabs";
import { PicksBoard } from "./PicksBoard";
import { WeekNotice } from "./WeekNotice";
import { WeekSummary } from "./WeekSummary";
import { WeekTabs } from "./WeekTabs";

export const dynamic = "force-dynamic";

export default async function PicksPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { week?: string; sport?: string };
}) {
  const { user } = await requireViewer(params.groupId);

  const sports = await sportsWithOpenWeeks();
  const requestedSport = isSport(searchParams.sport) ? searchParams.sport : null;
  const sport: Sport =
    requestedSport && sports.includes(requestedSport)
      ? requestedSport
      : (sports[0] ?? "nfl");

  // Only weeks that are open: pulled, and not yet closed. An unpulled week does
  // not exist yet as far as members are concerned, and a closed one is finished
  // and comes off the app. Its points stay on the leaderboard.
  const weeks = await listPickableWeeks(sport);

  const requested = searchParams.week
    ? weeks.find((week) => week.id === searchParams.week)
    : undefined;
  const week = requested ?? (await getCurrentWeek(sport));

  const basePath = `/g/${params.groupId}/picks`;

  if (!week) {
    return (
      <div>
        <SportTabs sports={sports} current={sport} basePath={basePath} />
        <div className="card p-6 text-center">
          <p className="text-sm font-medium">No {sportLabel(sport)} week is open.</p>
          <p className="mt-1 text-sm text-muted">
            An admin opens a week by pulling its lines from the Admin tab. Closed
            weeks come off this page, but their points stay on the leaderboard.
          </p>
        </div>
      </div>
    );
  }

  const board = await getWeekBoard(params.groupId, user.id, week.id);

  return (
    <div>
      <SportTabs sports={sports} current={sport} basePath={basePath} />

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
        />
      )}
    </div>
  );
}
