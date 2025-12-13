import { merge } from 'webpack-merge';
import common from './webpack.common.js';

const REPO_NAME = '/shards/';

export default (env) => {
    return merge(common(env), {
        mode: 'production',
        output: {
            publicPath: REPO_NAME,
        }
    });
};