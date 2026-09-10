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

  const [members, weeks, actions, adjustments] = await Promise.all([
    getMembers(params.groupId),
    listWeeks(),
    getAdminActions(params.groupId, 50),
    getPointAdjustments(params.groupId),
  ]);

  const week = searchParams.week
    ? ((await getWeek(searchParams.week)) ?? (await getCurrentWeek()))
    : await getCurrentWeek();

  const games = week ? await getGamesForWeek(week.id) : [];
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
    />
  );
}
