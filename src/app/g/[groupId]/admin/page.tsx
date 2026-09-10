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

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { week?: string };
}) {
  const { group } = await requireAdmin(params.groupId);

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
