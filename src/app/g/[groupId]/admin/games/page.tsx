import { requireAdmin } from "@/lib/auth";
import { getCurrentWeek, getGamesForWeek, getWeek, listWeeks } from "@/lib/queries";
import { GamesPanel } from "../GamesPanel";

export const dynamic = "force-dynamic";

/**
 * The games page. Nothing here talks to an external service, so it keeps the
 * platform's ordinary time limit rather than the long one the pull page needs.
 */
export default async function AdminGamesPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { week?: string };
}) {
  const { group } = await requireAdmin(params.groupId);

  // Admins see every week, closed ones included, so a closed week can still be
  // corrected. getCurrentWeek only returns open weeks, so fall back to the most
  // recently opened one when everything is closed.
  const weeks = await listWeeks();
  const mostRecentOpened = weeks.filter((candidate) => candidate.opened_at).at(-1) ?? null;
  const week =
    (searchParams.week ? await getWeek(searchParams.week) : null) ??
    (await getCurrentWeek()) ??
    mostRecentOpened;

  const games = week ? await getGamesForWeek(week.id) : [];

  return <GamesPanel groupId={group.id} weeks={weeks} week={week} games={games} />;
}
