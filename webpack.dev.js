const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
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