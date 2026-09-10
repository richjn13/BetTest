import { requireViewer } from "@/lib/auth";
import { getGroup } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { GroupNav } from "./GroupNav";
import { signOutAction, switchGroupAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { groupId: string };
}) {
  const { group, user } = await requireViewer(params.groupId);

  const session = getSession();
  const others = (
    await Promise.all(
      session.memberships
        .filter((membership) => membership.groupId !== group.id)
        .map(async (membership) => ({ membership, group: await getGroup(membership.groupId) })),
    )
  ).filter((entry) => entry.group !== null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3 pt-6">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{group.name}</h1>
          <p className="text-sm text-muted">
            {user.username}
            {user.is_admin && " · admin"}
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {others.map(({ membership, group: other }) => (
            <form key={membership.userId} action={switchGroupAction}>
              <input type="hidden" name="userId" value={membership.userId} />
              <input type="hidden" name="groupId" value={membership.groupId} />
              <button type="submit" className="text-accent hover:underline">
                {other!.name}
              </button>
            </form>
          ))}
          <form action={signOutAction}>
            <input type="hidden" name="userId" value={user.id} />
            <button type="submit" className="text-muted hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <GroupNav groupId={group.id} isAdmin={user.is_admin} />
      {children}
    </div>
  );
}
