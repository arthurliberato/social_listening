"use client";

import { useRouter } from "next/navigation";
import { Menu } from "@/components/ui/menu";
import { track } from "@/lib/analytics/client";

/** Switch between the workspaces you belong to. Each switch is one event, and the groups follow the new workspace. */
export function WorkspaceSwitcher({
  current,
  workspaces,
  canManage,
  landing,
}: {
  current: { id: string; name: string };
  workspaces: { id: string; slug: string; name: string }[];
  canManage: boolean;
  landing: string;
}) {
  const router = useRouter();
  if (workspaces.length <= 1 && !canManage)
    return (
      <span className="text-[var(--text-muted)]" data-testid="workspace-name">
        {current.name}
      </span>
    );
  return (
    <Menu
      testId="workspace-switcher"
      label={
        <span data-testid="workspace-name">
          <span className="sr-only">Workspace: </span>
          {current.name}
        </span>
      }
      items={[
        ...workspaces.map((w) => ({
          key: w.id,
          testId: `switch-${w.slug}`,
          label: (
            <span className="flex items-center gap-2">
              {w.name}
              {w.id === current.id && (
                <span className="text-xs text-[var(--text-muted)]">(current)</span>
              )}
            </span>
          ),
          onSelect: () => {
            if (w.id === current.id) return;
            track("Workspace Switched", { from_workspace_id: current.id });
            router.push(`/w/${w.slug}/${landing}`);
          },
        })),
        ...(canManage
          ? [
              {
                key: "manage",
                testId: "manage-workspaces",
                label: "Manage workspaces…",
                onSelect: () => router.push("/settings/workspaces"),
              },
            ]
          : []),
      ]}
    />
  );
}
