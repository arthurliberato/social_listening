# Teams, roles and workspaces (M9)

## Roles

One table, `lib/permissions.ts`, answers "who can do what". Pages, server actions and the UI all ask it.
`lib/permissions.test.ts` holds a hand-written truth table so a change to the matrix has to be deliberate.

| | Owner | Admin | Editor | Viewer | Client viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| Read mentions, queries, alerts, crisis rooms | ✓ | ✓ | ✓ | ✓ | |
| Read dashboards and reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create and edit content | ✓ | ✓ | ✓ | | |
| Export | ✓ | ✓ | ✓ | ✓ | |
| Members, workspaces, billing, branding, audit log | ✓ | ✓ | | | |

* **Who can change whom.** Owners manage anyone. Admins manage editors, viewers and client viewers, and
  can hand out only those roles. A workspace always keeps at least one owner. Nobody changes their own role
  from the Members screen.
* **Client viewers** see dashboards and reports only. Enforced in `requireWorkspace()`: any other
  section redirects to Dashboards, for pages and server actions alike. They don't use a seat.
* **Locked or cancelled accounts** drop everyone to read-only (see `docs/billing.md`).

## Seats

`lib/team/seats.ts`: people who work in the product, counted **once** across all of an account's workspaces,
plus unaccepted invitations (an invitee who already holds a seat doesn't take a second one). Client viewers
are free. Plan limits come from `plans.ts`.

## Invitations

Members → Invite. The email links to `/invite/<token>`:

* new address → "Create your account" (the existing invite-signup flow);
* an account already exists → "Log in to join", which returns to the invitation afterwards;
* signed in as the right person → one button to join; as someone else → told to switch accounts.

Tokens are stored hashed, expire after 7 days, and work once. Resend replaces the link; cancel kills it.
Everyone can **leave** a workspace from Settings → Workspaces (not your only workspace, not as its only owner).

## Workspaces

Create (within the plan's limit, otherwise a paywall), optionally copying another workspace's dashboards and
reports (query references are dropped: the copy never touches mention quota until it has its own queries).
Rename, archive and restore. Archiving pauses live queries (freeing their slots) and hides the workspace
everywhere; nothing is deleted. You can't archive your last active workspace.

## White-label (Agency and up)

Brand name, accent colour (must give white text 4.5:1 contrast), footer line, and "hide Powered by
Ripplewise". Applied to public share pages, PDF reports and the client viewer's top bar. Saved settings are
kept if the plan drops below Agency, and simply stop applying.

## Audit log (Enterprise)

`audit_log` records who did what for invitations, role changes, removals, workspace changes, plan and card
changes, public-link toggles, branding and signed Enterprise contracts. Since the content change it also
records what people do to the things the account is built on: queries (created, edited, paused, resumed,
deleted), dashboards (created, saved, duplicated, deleted), reports (created, saved, deleted, scheduled,
schedule stopped), alerts (created, muted, unmuted, deleted) and crisis rooms (opened, stakeholder update sent,
resolved, reopened). It is written on every plan (so history exists the day you upgrade) and readable on plans
that include it. Entries hold names, roles, counts and plan names, never secrets or personal data (a report
schedule records how many outside addresses it sends to, not the addresses).

Not logged on purpose: reads and exports, AI questions (counted in Usage instead), watchlist changes, individual
crisis tasks, and the frequent small edits inside the dashboard and report editors (only an explicit save is
recorded). `lib/audit.test.ts` fails if code records an action that has no readable label or filter category.

## Events

Server: `Teammate Invited`, `Invite Accepted`, `Seat Added`, `Client Viewer Added`, `Workspace Created`.
Client: `Workspace Switched` (with `from_workspace_id`).
