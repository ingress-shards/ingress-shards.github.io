import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const previewDir = path.join(rootDir, '.preview');

try {
    // 1. Get and sanitize current branch name
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    if (!branch) {
        throw new Error('Could not determine current branch.');
    }
    const sanitizedBranch = branch.replace(/\//g, '-');
    const artifactName = `preview-${sanitizedBranch}`;

    console.log(`🔍 Searching for artifact: ${artifactName}...`);

    // 2. Clear previous preview
    if (fs.existsSync(previewDir)) {
        fs.rmSync(previewDir, { recursive: true, force: true });
    }

    // 3. Download from GitHub using gh CLI
    console.log(`📥 Downloading latest artifact for branch "${branch}"...`);
    execSync(`gh run download --name "${artifactName}" --dir "${previewDir}"`, {
        stdio: 'inherit',
        cwd: rootDir
    });

    // 4. Serve the artifact
    console.log(`\n🚀 Serving preview at http://localhost:3000`);
    console.log(`💡 Press Ctrl+C to stop the server\n`);
    execSync(`npx serve "${previewDir}"`, {
        stdio: 'inherit',
        cwd: rootDir
    });

} catch (error) {
    if (error.message.includes('gh: command not found') || error.message.includes('gh is not recognized')) {
        console.error('\n❌ Error: GitHub CLI ("gh") is not installed.');
        console.log('📚 Install it via Winget: winget install --id GitHub.cli');
        console.log('🔑 Then authenticate: gh auth login\n');
    } else if (error.message.includes('no-artifact-found')) {
        console.error(`\n❌ Error: No artifact named "${error.artifactName}" found.`);
        console.log('⏳ Ensure the "Development Preview" GitHub Action has finished successfully.\n');
    } else {
        console.error(`\n❌ Error: ${error.message}\n`);
    }
    process.exit(1);
}
