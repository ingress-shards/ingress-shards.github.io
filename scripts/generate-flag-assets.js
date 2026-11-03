import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import seasonGeocode from '@ingress-shards/ingress-events-core/conf/season_geocode.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const genDir = path.join(rootDir, 'gen');
const flagsDestDir = path.join(genDir, 'flags');
const flagsSourceDir = path.join(rootDir, 'node_modules', 'flag-icons', 'flags', '4x3');

fs.mkdirSync(flagsDestDir, { recursive: true });

// 1. Collect all unique country codes from season geocodes
const countryCodes = new Set();
for (const season of seasonGeocode.seasons) {
    for (const site of season.sites) {
        if (site.countryCode) {
            countryCodes.add(site.countryCode.toLowerCase());
        }
    }
}

// 2. Generate flag-icons.css and copy needed SVGs
const cssRules = [
    '/* Generated from season_geocode.json - do not edit manually */',
    '.fi {',
    '  background-size: contain;',
    '  background-position: 50%;',
    '  background-repeat: no-repeat;',
    '  position: relative;',
    '  display: inline-block;',
    '  width: 1.333333em;',
    '  line-height: 1em;',
    '}',
    '.fi:before {',
    '  content: "\\00a0";',
    '}',
];

let copiedCount = 0;
for (const cc of Array.from(countryCodes).sort()) {
    const srcSvg = path.join(flagsSourceDir, `${cc}.svg`);
    const destSvg = path.join(flagsDestDir, `${cc}.svg`);

    if (fs.existsSync(srcSvg)) {
        fs.copyFileSync(srcSvg, destSvg);
        copiedCount++;
        cssRules.push(`.fi-${cc} {`);
        cssRules.push(`  background-image: url('flags/${cc}.svg');`);
        cssRules.push('}');
    } else {
        console.warn(`⚠️ Flag SVG not found for country code '${cc}' at ${srcSvg}`);
    }
}

const cssPath = path.join(genDir, 'flag-icons.css');
fs.writeFileSync(cssPath, cssRules.join('\n') + '\n', 'utf-8');
console.log(`Generated ${cssPath} and copied ${copiedCount} flag SVGs to ${flagsDestDir}.`);

