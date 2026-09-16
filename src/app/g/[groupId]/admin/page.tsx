import { requireAdmin } from "@/lib/auth";
import {
  getAdminActions,
  getCurrentWeek,
  getGamesForWeek,
  getMembers,
  getPicksForWeek,
  getPointAdjustments,
  getWeek,
  listWeeks,
} from "@/lib/queries";
import { listStoredPolls, readValue } from "@/lib/queries";
import { QUOTA_KEY, type RememberedQuota } from "@/lib/odds";
import { AdminPanel } from "./AdminPanel";

export const dynamic = "force-dynamic";

/**
 * Server actions inherit their time limit from the page that invokes them, and
 * this page invokes the two slowest things in the app: a refresh that talks to
 * an external feed, and a Claude pull that runs a web search. Vercel's default
 * is 10 seconds, which both can outlast -- the work finishes but the response
 * never arrives, so the browser shows an error over a job that succeeded.
 *
 * 300 seconds needs a Pro plan. Hobby allows at most 60, and a deploy that
 * asks for more than the plan permits is rejected. If a deploy fails naming
 * maxDuration, lower this to 60.
 */
export const maxDuration = 300;

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { week?: string };
}) {
  const { group, user } = await requireAdmin(params.groupId);

  // Every call the app makes writes the balance down, so this page reads it
  // rather than calling the feed itself. That took an outbound request on every
  // single load, before anything could render, for a number that only moves
  // when a call is actually spent.
  const [members, weeks, actions, adjustments, quota] = await Promise.all([
    getMembers(params.groupId),
    listWeeks(),
    getAdminActions(params.groupId, 50),
    getPointAdjustments(params.groupId),
    readValue<RememberedQuota>(QUOTA_KEY).catch(() => null),
  ]);

  // Admins see every week, closed ones included, so a closed week can be
  // reopened or corrected. getCurrentWeek only returns open weeks, so fall back
  // to the most recently opened one when everything is closed.
  const mostRecentOpened = weeks.filter((candidate) => candidate.opened_at).at(-1) ?? null;
  const week = searchParams.week
    ? ((await getWeek(searchParams.week)) ?? (await getCurrentWeek()) ?? mostRecentOpened)
    : ((await getCurrentWeek()) ?? mostRecentOpened);

  // The week's games and its picks, for the slate summary and the pick fixer.
  const [games, picks] = await Promise.all([
    week ? getGamesForWeek(week.id) : Promise.resolve([]),
    week
      ? getPicksForWeek(
          week.id,
          members.map((member) => member.id),
        )
      : Promise.resolve([]),
  ]);

  // Which weeks already have a poll, so the rankings box can say so for
  // whichever week is chosen there.
  const polls = await listStoredPolls().catch(() => []);

  return (
    <AdminPanel
      viewerId={user.id}
      group={group}
      members={members}
      weeks={weeks}
      week={week}
      games={games}
      picks={picks}
      actions={actions}
      adjustments={adjustments}
      quota={quota}
      polls={polls}
    />
  );
}
