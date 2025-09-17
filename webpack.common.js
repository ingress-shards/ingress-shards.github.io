import webpack from 'webpack';
import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';

export default {
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
            {
                // This rule specifically targets the resolved path of the loader script.
                // It ensures the loader is processed as a JavaScript module.
                test: path.resolve(process.cwd(), 'scripts/preprocessor-loader.js'),
                use: [path.resolve(process.cwd(), 'scripts/preprocessor-loader.js')],
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
        new webpack.NormalModuleReplacementPlugin(
            /processed_shard_series.json$/,
            (resource) => {
                resource.request = path.resolve(process.cwd(), 'scripts/preprocessor-loader.js');
            }
        ),
    ],
    resolve: {
        alias: {
            'leaflet.motion': path.resolve(process.cwd(), 'node_modules/leaflet.motion/dist/leaflet.motion.min.js'),
        }
    },
    output: {
        path: path.resolve(process.cwd(), 'dist'),
        filename: '[name].bundle.js',
        assetModuleFilename: 'images/[hash][ext][query]',
        clean: true,
    }
};