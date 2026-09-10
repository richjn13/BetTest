import { requireViewer } from "@/lib/auth";
import { getStandings } from "@/lib/queries";
import { formatPoints } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage({ params }: { params: { groupId: string } }) {
  const { user } = await requireViewer(params.groupId);
  const { standings, members, weeks } = await getStandings(params.groupId);

  const usernames = new Map(members.map((member) => [member.id, member.username]));
  const weekLabels = new Map(weeks.map((week) => [week.id, week.label]));

  if (standings.length === 0) {
    return <p className="card p-6 text-center text-muted">No members yet.</p>;
  }

  // Equal points and equal non-lock wins share a rank.
  let lastKey = "";
  let lastRank = 0;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Season standings</h2>
      <p className="mb-4 text-sm text-muted">
        Ties broken by most correct non-lock picks. Tap a row for the week-by-week
        breakdown.
      </p>

      <ol className="space-y-2">
        {standings.map((standing, index) => {
          const key = `${standing.totalPoints}:${standing.correctNonLock}`;
          const rank = key === lastKey ? lastRank : index + 1;
          lastKey = key;
          lastRank = rank;

          const isViewer = standing.userId === user.id;
          const weeksPlayed = [...standing.weeks].sort((a, b) =>
            (weekLabels.get(a.weekId) ?? "").localeCompare(weekLabels.get(b.weekId) ?? "", undefined, {
              numeric: true,
            }),
          );

          return (
            <li key={standing.userId}>
              <details className={`card ${isViewer ? "border-accent" : ""}`}>
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                  <span className="w-6 shrink-0 font-mono text-sm text-muted">{rank}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {usernames.get(standing.userId) ?? "Unknown"}
                    {isViewer && <span className="ml-2 text-xs text-muted">you</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg font-semibold tabular-nums">
                      {formatPoints(standing.totalPoints)}
                    </span>
                    <span className="block text-xs text-muted">
                      {standing.correct} correct
                    </span>
                  </span>
                </summary>

                <div className="border-t border-edge px-4 py-3">
                  {weeksPlayed.length === 0 ? (
                    <p className="text-sm text-muted">No picks yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-muted">
                          <th className="pb-1 font-medium">Week</th>
                          <th className="pb-1 text-right font-medium">Points</th>
                          <th className="pb-1 text-right font-medium">Correct</th>
                          <th className="pb-1 text-right font-medium">Pending</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeksPlayed.map((week) => (
                          <tr key={week.weekId} className="border-t border-edge/60">
                            <td className="py-1.5">{weekLabels.get(week.weekId) ?? "Week"}</td>
                            <td className="py-1.5 text-right font-medium tabular-nums">
                              {formatPoints(week.points)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted">
                              {week.correct}/{week.graded}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted">
                              {week.pending || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
