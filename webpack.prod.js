import { merge } from 'webpack-merge';
import common, { packageJson } from './webpack.common.js';

const REPO_NAME = '/shards/';

export default (env) => {
    return merge(common(env, { appVersion: packageJson.version }), {
        mode: 'production',
        output: {
            publicPath: REPO_NAME,
        }
    });
};