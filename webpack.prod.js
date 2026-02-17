import { merge } from 'webpack-merge';
import common, { packageJson } from './webpack.common.js';

const REPO_NAME = '/';

export default (env) => {
    const appVersion = process.env.APP_VERSION || packageJson.version;
    return merge(common(env, { appVersion }), {
        mode: 'production',
        output: {
            publicPath: REPO_NAME,
        }
    });
};