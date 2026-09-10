import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Home() {
  const session = getSession();
  const active =
    session.memberships.find((membership) => membership.userId === session.activeUserId) ??
    session.memberships[0];

  redirect(active ? `/g/${active.groupId}/picks` : "/join");
}
