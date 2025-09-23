import { merge } from 'webpack-merge';
import common from './webpack.common.js';

export default (env) => {
    return merge(common(env), {
        mode: 'development',
        devtool: 'eval-source-map',
        devServer: {
            static: './dist',
            client: {
                overlay: false,
            },
            hot: true,
            historyApiFallback: true,
        },
    });
};