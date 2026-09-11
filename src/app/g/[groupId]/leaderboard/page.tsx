import { requireViewer } from "@/lib/auth";
import { getStandings } from "@/lib/queries";
import { formatPoints } from "@/lib/format";
import type { WeekTotals } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage({ params }: { params: { groupId: string } }) {
  const { user } = await requireViewer(params.groupId);
  const { standings, members, weeks } = await getStandings(params.groupId);

  const usernames = new Map(members.map((member) => [member.id, member.username]));

  if (standings.length === 0) {
    return <p className="card p-6 text-center text-sm text-muted">No members yet.</p>;
  }

  // Weeks arrive oldest first; the newest is the one people look at.
  const columns = [...weeks].reverse();

  // Equal points and equal non-lock wins share a rank.
  let lastKey = "";
  let lastRank = 0;

  const rows = standings.map((standing, index) => {
    const key = `${standing.totalPoints}:${standing.correctNonLock}`;
    const rank = key === lastKey ? lastRank : index + 1;
    lastKey = key;
    lastRank = rank;

    const byWeek = new Map<string, WeekTotals>(
      standing.weeks.map((week) => [week.weekId, week]),
    );
    return { standing, rank, byWeek, isViewer: standing.userId === user.id };
  });

  const best = new Map<string, number>();
  for (const week of columns) {
    const scores = rows
      .map((row) => row.byWeek.get(week.id)?.points ?? null)
      .filter((points): points is number => points !== null);
    if (scores.length > 0) best.set(week.id, Math.max(...scores));
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Standings</h2>
        <p className="text-sm text-muted">
          Highest total first. Ties broken by most correct non-lock picks.
        </p>
      </header>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left text-xs
                           font-semibold uppercase tracking-wide text-muted"
              >
                Player
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-right text-xs font-semibold uppercase
                           tracking-wide text-ink"
              >
                Total
              </th>
              {columns.map((week) => (
                <th
                  key={week.id}
                  scope="col"
                  className="px-3 py-2 text-right text-xs font-semibold uppercase
                             tracking-wide text-muted"
                >
                  {week.season_type === "regular" ? `Wk ${week.week_number}` : week.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map(({ standing, rank, byWeek, isViewer }) => (
              <tr key={standing.userId} className={isViewer ? "bg-accent/[0.07]" : undefined}>
                <th
                  scope="row"
                  className={`sticky left-0 z-10 border-t border-edge py-3 pr-3 text-left
                              font-medium ${isViewer ? "bg-[rgb(var(--surface))]" : "bg-surface"}`}
                >
                  <span className="mr-2 font-mono text-xs text-muted">{rank}</span>
                  {usernames.get(standing.userId) ?? "Unknown"}
                  {isViewer && <span className="ml-2 text-xs font-normal text-muted">you</span>}
                </th>

                <td className="border-t border-edge px-3 py-3 text-right">
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {formatPoints(standing.totalPoints)}
                  </span>
                </td>

                {columns.map((week) => {
                  const totals = byWeek.get(week.id);
                  const isBest =
                    totals !== undefined &&
                    totals.points > 0 &&
                    best.get(week.id) === totals.points;

                  return (
                    <td
                      key={week.id}
                      className="border-t border-edge px-3 py-3 text-right font-mono
                                 tabular-nums"
                    >
                      {totals === undefined ? (
                        <span className="text-muted">&mdash;</span>
                      ) : (
                        <span
                          className={
                            isBest
                              ? "rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400"
                              : totals.points > 0
                                ? "text-ink"
                                : "text-muted"
                          }
                          title={
                            totals.pending > 0
                              ? `${totals.correct}/${totals.graded} correct, ${totals.pending} still to grade`
                              : `${totals.correct}/${totals.graded} correct`
                          }
                        >
                          {formatPoints(totals.points)}
                          {totals.pending > 0 && (
                            <span className="ml-0.5 text-[10px] text-muted">*</span>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        Green marks the best score that week. An asterisk means some of that
        week&apos;s picks are still to be graded. A dash means no picks were made.
      </p>
    </section>
  );
}
