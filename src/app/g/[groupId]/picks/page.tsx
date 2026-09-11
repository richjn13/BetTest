import { requireViewer } from "@/lib/auth";
import { getCurrentWeek, getWeekBoard, listPickableWeeks } from "@/lib/queries";
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
  searchParams: { week?: string };
}) {
  const { user } = await requireViewer(params.groupId);

  // Only weeks that are open: pulled, and not yet closed. An unpulled week does
  // not exist yet as far as members are concerned, and a closed one is finished
  // and comes off the app. Its points stay on the leaderboard.
  const weeks = await listPickableWeeks();

  const requested = searchParams.week
    ? weeks.find((week) => week.id === searchParams.week)
    : undefined;
  const week = requested ?? (await getCurrentWeek());

  if (!week) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-medium">No week is open.</p>
        <p className="mt-1 text-sm text-muted">
          An admin opens a week by pulling its lines from the Admin tab. Closed
          weeks come off this page, but their points stay on the leaderboard.
        </p>
      </div>
    );
  }

  const board = await getWeekBoard(params.groupId, user.id, week.id);

  return (
    <div>
      <WeekTabs
        weeks={weeks}
        currentWeekId={week.id}
        basePath={`/g/${params.groupId}/picks`}
      />

      <WeekNotice week={week} cards={board} />

      {board.length > 0 && <WeekSummary cards={board} weekLabel={week.label} />}

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
          weekLabel={week.label}
          readOnly={false}
        />
      )}
    </div>
  );
}
