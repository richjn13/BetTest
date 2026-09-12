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
import { getStoredPoll } from "@/lib/queries";
import { probeOddsFeed } from "@/lib/odds";
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

  // The feed's own /sports endpoint is not billed, and every response carries
  // the quota counters, so the balance can be shown before a button is pressed
  // without that costing a call itself.
  const [members, weeks, actions, adjustments, probe] = await Promise.all([
    getMembers(params.groupId),
    listWeeks(),
    getAdminActions(params.groupId, 50),
    getPointAdjustments(params.groupId),
    probeOddsFeed().catch(() => null),
  ]);

  // Admins see every week, closed ones included, so a closed week can be
  // reopened or corrected. getCurrentWeek only returns open weeks, so fall back
  // to the most recently opened one when everything is closed.
  const mostRecentOpened = weeks.filter((candidate) => candidate.opened_at).at(-1) ?? null;
  const week = searchParams.week
    ? ((await getWeek(searchParams.week)) ?? (await getCurrentWeek()) ?? mostRecentOpened)
    : ((await getCurrentWeek()) ?? mostRecentOpened);

  const games = week ? await getGamesForWeek(week.id) : [];

  // Whether a college week already has its rankings decides what the pull box
  // says, and reading it is one cheap query.
  const collegeWeek = weeks.filter((candidate) => candidate.sport === "ncaaf").at(-1) ?? null;
  const poll = collegeWeek
    ? await getStoredPoll(collegeWeek.season_year, collegeWeek.week_number).catch(() => null)
    : null;
  const picks = week
    ? await getPicksForWeek(
        week.id,
        members.map((member) => member.id),
      )
    : [];

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
      quota={probe?.ok ? probe.quota : null}
      poll={
        poll && collegeWeek
          ? {
              seasonYear: collegeWeek.season_year,
              weekNumber: collegeWeek.week_number,
              ranked: poll.entries.length,
              source: poll.source,
            }
          : null
      }
    />
  );
}
