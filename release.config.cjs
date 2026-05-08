module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        "preset": "conventionalcommits",
        "parserOpts": {
          "noteKeywords": ["BREAKING CHANGE", "BREAKING CHANGES", "BREAKING"]
        },
        "releaseRules": [
          { "type": "refactor", "release": "patch" },
          { "type": "docs", "scope": "README", "release": "patch" },
          { "type": "ci", "release": "patch" },
          { "scope": "no-release", "release": false }
        ]
      }
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        "preset": "conventionalcommits",
        "presetConfig": {
          "types": [
            { "type": "feat", "section": "✨ Features" },
            { "type": "fix", "section": "🐛 Bug Fixes" },
            { "type": "refactor", "section": "♻️ Refactoring", "hidden": false },
            { "type": "ci", "section": "🔧 CI/CD", "hidden": false },
            { "type": "docs", "section": "📝 Documentation", "hidden": false },
            { "type": "perf", "section": "🚀 Performance" }
          ]
        },
        "writerOpts": {
          "commitsSort": ["subject", "scope"],
          "linkCompare": false
        }
      }
    ],
    "semantic-release-export-data",
    [
      "@semantic-release/npm",
      {
        "npmPublish": false
      }
    ],
    [
      "@semantic-release/exec",
      {
        "publishCmd": "APP_VERSION=${nextRelease.version} npm run build && zip -r ingress-shards-map-${nextRelease.version}.zip dist"
      }
    ],
    [
      "@semantic-release/github",
      {
        "assets": [
          {
            "path": "ingress-shards-map-*.zip",
            "label": "Ingress Shards Map (${nextRelease.version})"
          }
        ]
      }
    ]
  ]
};
