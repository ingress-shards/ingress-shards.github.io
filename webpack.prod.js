import { merge } from 'webpack-merge';
import common from './webpack.common.js';

export default (env) => {
    return merge(common(env), {
        mode: 'production',
    });
};