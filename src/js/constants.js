export const SHARD_EVENT_TYPE = {
    SKIRMISH: "skirmish",
    SINGULAR: "singular",
    ANOMALY: "anomaly",
};
export const TEAM_ABBREVIATIONS = {
    "RESISTANCE": "RES",
    "ENLIGHTENED": "ENL",
    "MACHINA": "MAC",
}
export const FACTION_COLORS = {
    NEU: "#FF6600",
    RES: "#0088FF",
    ENL: "#03DC03",
    MAC: "#FF0028",
    NOT_SPECIFIED: "#FF6600",
    undefined: "#FF6600",
};
export const HISTORY_REASONS = {
    SPAWN: "spawn",
    NO_MOVE: "no move",
    LINK: "link",
    JUMP: "jump",
    DESPAWN: "despawn",
};

export function getAbbreviatedTeam(fullTeamName) {
    return TEAM_ABBREVIATIONS[fullTeamName];
}
