import eventBlueprints from "../../conf/event_blueprints.json" with { type: "json" };

export const INGRESS_INTEL_PORTAL_LINK = 'https://intel.ingress.com/intel?pll='

// Direct reference to blueprint brands
export const EVENT_BRANDS = eventBlueprints.brands;
export const TEAM_ABBREVIATIONS = {
    "RESISTANCE": "RES",
    "ENLIGHTENED": "ENL",
    "MACHINA": "MAC",
    "NEUTRAL": "NEU",
};
export const FACTION_COLORS = {
    NEU: "#FF6600",
    RES: "#0088FF",
    ENL: "#03DC03",
    MAC: "#FF0028",
    NOT_SPECIFIED: "#FF6600",
    undefined: "#FF6600",
};
export const RANDOM_TELEPORT_COLOR = "#FFCC00";
export const HISTORY_REASONS = {
    SPAWN: "spawn",
    NO_MOVE: "no move",
    LINK: "link",
    JUMP: "jump",
    DESPAWN: "despawn",
};

export const SITE_AGGREGATION_DISTANCE = 10000;
export const CUSTOM_SERIES_ID = "custom";

export function getAbbreviatedTeam(fullTeamName) {
    return TEAM_ABBREVIATIONS[fullTeamName];
}

export const FILE_PATTERNS = [
    { type: 'shardJumpTimes', pattern: /^shard-jump-times.*\.json$/i },
];