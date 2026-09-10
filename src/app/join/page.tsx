import Link from "next/link";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { getGroup } from "@/lib/queries";
import { JoinForms } from "./JoinForms";

export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const session = getSession();
  const groups = await Promise.all(
    session.memberships.map(async (membership) => ({
      membership,
      group: await getGroup(membership.groupId),
    })),
  );
  const existing = groups.filter((entry) => entry.group !== null);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Pick&apos;em</h1>
        <p className="mt-1 text-muted">
          Pick every game against the spread. One lock a week, worth double.
        </p>
      </header>

      {existing.length > 0 && (
        <section className="mb-6">
          <h2 className="label">Your pools</h2>
          <ul className="space-y-2">
            {existing.map(({ membership, group }) => (
              <li key={membership.userId}>
                <Link
                  href={`/g/${membership.groupId}/picks`}
                  className="card flex items-center justify-between px-4 py-3 hover:border-accent"
                >
                  <span className="font-medium">{group!.name}</span>
                  <span aria-hidden className="text-muted">
                    &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <JoinForms canCreate={env.createGroupSecret !== null} />
    </main>
  );
}
