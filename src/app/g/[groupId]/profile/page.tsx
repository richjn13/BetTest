import { requireViewer } from "@/lib/auth";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: { groupId: string } }) {
  const { user } = await requireViewer(params.groupId);

  return (
    <section className="max-w-lg space-y-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Your profile</h2>
        <p className="text-sm text-muted">
          How you appear on the leaderboard. All of it is optional.
        </p>
      </header>

      <div className="card p-4 sm:p-5">
        <ProfileForm
          groupId={params.groupId}
          username={user.username}
          displayName={user.display_name}
          email={user.email}
          avatarUrl={user.avatar_url}
        />
      </div>
    </section>
  );
}
