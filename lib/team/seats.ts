// Seats: people who work in the product. Counted once per person across all of an account's workspaces,
// including invitations that haven't been accepted yet. Client viewers are free.
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { db, invitations, memberships, users } from "@/db/client";

export interface SeatUsage {
  members: number;
  pending: number;
  clientViewers: number;
  used: number;
}

export async function seatUsage(accountId: string): Promise<SeatUsage> {
  const staff = await db
    .selectDistinct({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.accountId, accountId), ne(memberships.role, "client_viewer")));
  const staffIds = new Set(staff.map((s) => s.id));
  const clients = await db
    .selectDistinct({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "client_viewer")));
  const pendingRows = await db
    .selectDistinct({ email: invitations.email })
    .from(invitations)
    .where(
      and(
        eq(invitations.accountId, accountId),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
        ne(invitations.role, "client_viewer"),
      ),
    );
  // An invitation to someone who already holds a seat (in another workspace) doesn't take a second one.
  const seated = staffIds.size
    ? new Set(
        (
          await db
            .select({ email: users.email, id: users.id })
            .from(users)
            .innerJoin(memberships, eq(memberships.userId, users.id))
            .where(and(eq(memberships.accountId, accountId), ne(memberships.role, "client_viewer")))
        ).map((u) => u.email.toLowerCase()),
      )
    : new Set<string>();
  const pending = pendingRows.filter((p) => !seated.has(p.email.toLowerCase())).length;
  return {
    members: staffIds.size,
    pending,
    clientViewers: clients.filter((c) => !staffIds.has(c.id)).length,
    used: staffIds.size + pending,
  };
}
