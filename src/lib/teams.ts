import type { Team } from "./types";

// Four factions. The player is BLUE by default; the other three are driven by
// the simulation so the map feels contested even in single-player. When real
// multiplayer arrives, these become real player factions.
export const TEAMS: Team[] = [
  { id: "blue", name: "Blå", color: "#3b82f6" },
  { id: "red", name: "Rød", color: "#ef4444" },
  { id: "green", name: "Grønn", color: "#22c55e" },
  { id: "amber", name: "Gul", color: "#f59e0b" },
];

export const TEAM_BY_ID: Record<string, Team> = Object.fromEntries(
  TEAMS.map((t) => [t.id, t]),
);

export const NEUTRAL_COLOR = "#94a3b8";

export function teamColor(teamId: string | null): string {
  if (!teamId) return NEUTRAL_COLOR;
  return TEAM_BY_ID[teamId]?.color ?? NEUTRAL_COLOR;
}

/** Teams the simulation controls (everyone except the local player's team). */
export function rivalTeams(playerTeamId: string): Team[] {
  return TEAMS.filter((t) => t.id !== playerTeamId);
}
