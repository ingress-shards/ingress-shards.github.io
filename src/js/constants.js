export const INGRESS_INTEL_PORTAL_LINK = 'https://intel.ingress.com/intel?pll='

export const SHARD_EVENT_TYPE = {
    ANOMALY: {
        name: "Anomaly",
        multipleShards: true,
        markerFilter: 'hue-rotate(30deg)',
        typeOrder: 1,
    },
    SKIRMISH: {
        name: "Shard Skirmish",
        multipleShards: true,
        markerFilter: 'hue-rotate(120deg)',
        typeOrder: 2,
    },
    SINGULAR: {
        name: "Shard Singular",
        multipleShards: false,
        markerFilter: 'hue-rotate(330deg)',
        typeOrder: 3,
    },
    STORM: {
        name: "Shard Storm",
        multipleShards: false,
        markerFilter: 'hue-rotate(210deg)',
        typeOrder: 4,
    },
    SINGLE_SHARD: {
        name: "Single Shard",
        multipleShards: false,
        markerFilter: 'hue-rotate(180deg)',
        typeOrder: 5,
    },
    MULTIPLE_SHARDS: {
        name: "Multiple Shards",
        multipleShards: true,
        markerFilter: 'hue-rotate(60deg)',
        typeOrder: 6,
    },
    UNKNOWN: {
        name: "Unknown",
        multipleShards: false,
        markerFilter: 'grayscale(1)',
        typeOrder: 7,
    },
};
export const TEAM_ABBREVIATIONS = {
    "RESISTANCE": "RES",
    "ENLIGHTENED": "ENL",
    "MACHINA": "MAC",
};
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

export const SITE_AGGREGATION_DISTANCE = 10000;
export const CUSTOM_SERIES_ID = "custom";

export function getAbbreviatedTeam(fullTeamName) {
    return TEAM_ABBREVIATIONS[fullTeamName];
}

export const FILE_PATTERNS = [
    { type: 'shardJumpTimes', pattern: /^shard-jump-times.*\.json$/i },
];