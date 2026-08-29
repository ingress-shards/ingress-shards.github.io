import path from 'path';
import { fileURLToPath } from 'url';
import { merge } from 'webpack-merge';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import common, { packageJson } from './webpack.common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_NAME = '/';

export default (env = {}) => {
    const appVersion = process.env.APP_VERSION || packageJson.version;
    return merge(common(env, { appVersion }), {
        mode: 'production',
        module: {
            rules: [
                {
                    test: /\.css$/,
                    use: [MiniCssExtractPlugin.loader, 'css-loader'],
                },
            ],
        },
        optimization: {
            splitChunks: {
                chunks: 'all',
                maxInitialRequests: 10,
                minSize: 20000,
                cacheGroups: {
                    maplibre: {
                        test: /[\\/]node_modules[\\/](maplibre-gl|@maplibre)[\\/]/,
                        name: 'vendor-maplibre',
                        chunks: 'all',
                        priority: 30,
                    },
                    leaflet: {
                        test: /[\\/]node_modules[\\/](leaflet|leaflet-providers|leaflet-relief|leaflet\.motion)[\\/]/,
                        name: 'vendor-leaflet',
                        chunks: 'all',
                        priority: 25,
                    },
                    temporal: {
                        test: /[\\/]node_modules[\\/]temporal-polyfill[\\/]/,
                        name: 'vendor-temporal',
                        chunks: 'all',
                        priority: 20,
                    },
                    vendors: {
                        test: /[\\/]node_modules[\\/]/,
                        name: 'vendor-core',
                        chunks: 'all',
                        priority: 10,
                    },
                },
            },
        },
        output: {
            publicPath: REPO_NAME,
            filename: 'js/[name].[contenthash:8].js',
            chunkFilename: 'js/[name].[contenthash:8].js',
        },
        plugins: [
            new MiniCssExtractPlugin({
                filename: 'css/[name].[contenthash:8].css',
                chunkFilename: 'css/[name].[contenthash:8].css',
            }),
            ...(env.analyze ? [
                new BundleAnalyzerPlugin({
                    analyzerMode: 'static',
                    openAnalyzer: false,
                    reportFilename: path.resolve(__dirname, 'dist/bundle-report.html'),
                }),
            ] : []),
        ],
    });
};