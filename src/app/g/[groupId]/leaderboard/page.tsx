import { Avatar } from "@/components/Avatar";
import { sportConfig } from "@/lib/sports";
import { requireViewer } from "@/lib/auth";
import { getStandings } from "@/lib/queries";
import { formatPoints } from "@/lib/format";
import type { WeekTotals } from "@/lib/scoring";

export const dynamic = "force-dynamic";

function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

export default async function LeaderboardPage({ params }: { params: { groupId: string } }) {
  const { user } = await requireViewer(params.groupId);
  const { standings, members, weeks } = await getStandings(params.groupId);

  const byId = new Map(members.map((member) => [member.id, member]));

  if (standings.length === 0) {
    return <p className="card p-6 text-center text-sm text-muted">No members yet.</p>;
  }

  // Week 1 first, then ascending. Reading left to right follows the season.
  const columns = weeks;

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

  const you = rows.find((row) => row.isViewer);
  const yourMember = you ? byId.get(you.standing.userId) : undefined;
  const graded = you
    ? you.standing.weeks.reduce((sum, week) => sum + week.graded, 0)
    : 0;

  return (
    <section className="space-y-4">
      {you && yourMember && (
        <div className="card flex items-center gap-4 p-4 sm:p-5">
          <Avatar
            username={yourMember.username}
            avatarUrl={yourMember.avatar_url}
            size={64}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold leading-tight">
              {yourMember.display_name || yourMember.username}
            </p>
            <p className="text-sm text-muted">
              {yourMember.display_name ? `${yourMember.username} · ` : ""}
              {ordinal(you.rank)} of {rows.length}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-3xl font-semibold leading-none tabular-nums">
              {formatPoints(you.standing.totalPoints)}
            </p>
            <p className="mt-1 text-xs text-muted">
              points · {you.standing.correct}/{graded}
            </p>
          </div>
        </div>
      )}

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
                  {/* Both sports number their weeks, so say which is which. */}
                  {sportConfig(week.sport).short} {week.week_number}
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
                  <span className="inline-flex items-center gap-2 align-middle">
                    <Avatar
                      username={byId.get(standing.userId)?.username ?? "?"}
                      avatarUrl={byId.get(standing.userId)?.avatar_url ?? null}
                      size={26}
                    />
                    <span className="truncate">
                      {byId.get(standing.userId)?.username ?? "Unknown"}
                    </span>
                  </span>
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
