import path from 'path';
import { fileURLToPath } from 'url';
import { merge } from 'webpack-merge';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import TerserPlugin from 'terser-webpack-plugin';
import common, { packageJson } from './webpack.common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            runtimeChunk: 'single',
            minimizer: [
                new TerserPlugin({
                    minify: TerserPlugin.swcMinify,
                }),
            ],
            splitChunks: {
                chunks: 'all',
                maxInitialRequests: 10,
                minSize: 20000,
                cacheGroups: {
                    maplibre: {
                        test: /[\\/]node_modules[\\/](maplibre-gl|@maplibre)[\\/]/,
                        name: 'vendor-maplibre',
                        priority: 30,
                    },
                    leaflet: {
                        test: /[\\/]node_modules[\\/](leaflet|leaflet-providers|leaflet-relief|leaflet\.motion)[\\/]/,
                        name: 'vendor-leaflet',
                        priority: 25,
                    },
                    temporal: {
                        test: /[\\/]node_modules[\\/]temporal-polyfill[\\/]/,
                        name: 'vendor-temporal',
                        priority: 20,
                    },
                    vendors: {
                        test: /[\\/]node_modules[\\/]/,
                        name: 'vendor-core',
                        priority: 10,
                    },
                },
            },
        },
        output: {
            filename: 'js/[name].[contenthash:8].js',
            chunkFilename: 'js/[name].[contenthash:8].js',
        },
        performance: {
            // Exclude lazily fetched season JSON, copied worker scripts, and static images from bundle size warnings.
            assetFilter: (assetFilename) =>
                /\.(js|css)$/.test(assetFilename) && !assetFilename.startsWith('js/maplibre-gl-'),
            maxAssetSize: 1536 * 1024, // 1.5 MiB
            maxEntrypointSize: 1536 * 1024, // 1.5 MiB
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