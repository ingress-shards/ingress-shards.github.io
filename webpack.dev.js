import { merge } from 'webpack-merge';
import { execSync } from 'child_process';
import common, { packageJson } from './webpack.common.js';

let gitCommitHash = '';
try {
    gitCommitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
    console.warn('Could not get git commit hash: ', e);
}

export default (env) => {
    const appVersion = gitCommitHash ? `${packageJson.version}-${gitCommitHash}` : packageJson.version;
    return merge(common(env, { appVersion }), {
        mode: 'development',
        devtool: 'eval-source-map',
        devServer: {
            static: './dist',
            client: {
                overlay: false,
            },
            hot: true,
            historyApiFallback: true,
            headers: {
                "Access-Control-Allow-Origin": "https://intel.ingress.com",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization"
            }
        },
    });
};
