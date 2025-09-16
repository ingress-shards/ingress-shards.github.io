const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: './src/js/index.js',
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif)$/i,
                type: 'asset/resource',
            },
        ],
    },
    plugins: [
        new webpack.ProvidePlugin({
            $: 'jquery',
            jQuery: 'jquery'
        }),
        new HtmlWebpackPlugin({
            template: './index.html',
            favicon: './src/assets/abaddon1_shard.png',
            meta: {
                viewport: 'width=device-width, initial-scale=1',
                'og:description': 'Interactive map of shard data from Ingress events',
                'og:title': { property: 'og:title', content: 'Ingress Shards' },
            }
        }),
    ],
    resolve: {
        alias: {
            'leaflet.motion': path.resolve(__dirname, 'node_modules/leaflet.motion/dist/leaflet.motion.min.js')
        }
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].bundle.js',
        assetModuleFilename: 'images/[hash][ext][query]',
        clean: true,
    }
};