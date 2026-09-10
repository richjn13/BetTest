import { requireViewer } from "@/lib/auth";
import { getCurrentWeek, getWeek, getWeekBoard, listWeeks } from "@/lib/queries";
import { abbreviate } from "@/lib/teams";
import { GameRow } from "./GameRow";
import { WeekPicker } from "./WeekPicker";

export const dynamic = "force-dynamic";

export default async function PicksPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { week?: string };
}) {
  const { user } = await requireViewer(params.groupId);

  const weeks = await listWeeks();
  const week = searchParams.week
    ? ((await getWeek(searchParams.week)) ?? (await getCurrentWeek()))
    : await getCurrentWeek();

  if (!week) {
    return (
      <p className="card p-6 text-center text-muted">
        No games yet. An admin can add the week&apos;s slate from the Admin tab, or the
        odds refresh will pull it in.
      </p>
    );
  }

  const board = await getWeekBoard(params.groupId, user.id, week.id);
  const open = board.filter((card) => card.isOpen);
  const picked = board.filter((card) => card.pick !== null).length;
  const lock = board.find((card) => card.pick?.is_lock);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{week.label}</h2>
          <p className="text-sm text-muted">
            {picked} of {board.length} picked
            {lock
              ? ` · lock on ${abbreviate(
                  lock.pick!.picked_side === "home"
                    ? lock.game.home_team
                    : lock.game.away_team,
                )}`
              : " · no lock set"}
          </p>
        </div>
        <WeekPicker
          weeks={weeks}
          currentWeekId={week.id}
          basePath={`/g/${params.groupId}/picks`}
        />
      </div>

      {board.length === 0 ? (
        <p className="card p-6 text-center text-muted">No games scheduled for this week.</p>
      ) : (
        <ul className="space-y-2">
          {board.map((card) => (
            <GameRow key={card.game.id} card={card} groupId={params.groupId} />
          ))}
        </ul>
      )}

      {board.length > 0 && (
        <p className="mt-4 text-xs text-muted">
          Picks stay changeable until each game kicks off, one game at a time. Everyone
          else&apos;s picks appear once a game starts.
          {open.length === 0 && " Every game this week is locked."}
        </p>
      )}
    </section>
  );
}
