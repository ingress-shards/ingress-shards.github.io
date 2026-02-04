import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolvePackage = (pkg) => path.dirname(fileURLToPath(import.meta.resolve(`${pkg}/package.json`)));

export const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default (env, { appVersion }) => {
    return {
        entry: './src/js/index.js',
        module: {
            rules: [
                {
                    test: path.resolve(__dirname, 'src/js/data/json-parser-worker.js'),
                    type: 'asset/resource',
                    generator: {
                        filename: 'workers/[name][ext]',
                    },
                },
                {
                    test: /\.css$/,
                    include: [
                        resolvePackage('flag-icon-css')
                    ],
                    use: [
                        'style-loader',
                        {
                            loader: 'css-loader',
                        },
                    ],
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader'],
                    exclude: [
                        resolvePackage('flag-icon-css')
                    ],
                },
                {
                    test: /abaddon1_shard\.png$/,
                    type: 'asset/resource',
                    generator: {
                        filename: 'images/abaddon1_shard.png',
                    },
                },
                {
                    test: /\.(png|svg|jpg|jpeg|gif)$/i,
                    include: [
                        resolvePackage('flag-icon-css')
                    ],
                    exclude: [
                        /abaddon1_shard\.png$/
                    ],
                    type: 'asset/resource',
                    generator: {
                        filename: 'images/flag-icons/[name].[contenthash:8][ext]',
                    },
                },
                {
                    test: /\.(png|svg|jpg|jpeg|gif)$/i,
                    exclude: [
                        resolvePackage('flag-icon-css'),
                        /abaddon1_shard\.png$/,
                        resolvePackage('leaflet')
                    ],
                    type: 'asset/resource',
                    generator: {
                        filename: 'images/[name].[contenthash:8][ext]',
                    },
                },
                {
                    test: /\.(png|svg|jpg|jpeg|gif)$/i,
                    include: [
                        resolvePackage('leaflet')
                    ],
                    type: 'asset/resource',
                    generator: {
                        filename: 'images/markers/[name][ext]',
                        emit: false,
                    },
                },
                // Markers are copied manually below to ensure the complete set (shadows, @2x) is present.
                // The rule above handles path resolution for files explicitly imported or used in CSS.
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                __APP_VERSION__: JSON.stringify(appVersion),
            }),
            new HtmlWebpackPlugin({
                template: './index.html',
                favicon: './src/images/abaddon1_shard.png',
                meta: {
                    viewport: 'width=device-width, initial-scale=1',
                    'og:description': 'Interactive map of shard data from Ingress events',
                    'og:title': { property: 'og:title', content: 'Ingress Shards Map' },
                }
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: path.join(resolvePackage('leaflet'), 'dist', 'images'),
                        to: 'images/markers',
                    },
                    {
                        from: path.resolve(__dirname, 'conf/event_blueprints.json'),
                        to: 'public/conf/',
                        transform(content) {
                            const blueprints = JSON.parse(content.toString());
                            blueprints.version = appVersion;
                            return JSON.stringify(blueprints, null, 2);
                        },
                    },
                    {
                        from: path.resolve(__dirname, 'conf/series_metadata.json'),
                        to: 'public/conf/',
                        transform(content) {
                            const metadata = JSON.parse(content.toString());
                            metadata.version = appVersion;
                            return JSON.stringify(metadata, null, 2);
                        },
                    },
                    {
                        from: path.resolve(__dirname, 'gen/series_geocode.json'),
                        to: 'public/conf/',
                        transform(content) {
                            const geocode = JSON.parse(content.toString());
                            geocode.version = appVersion;
                            return JSON.stringify(geocode, null, 2);
                        },
                    },
                    {
                        from: path.resolve(__dirname, 'docs/assets/shard-site.png'),
                        to: 'images/',
                    },
                ]
            }),
            {
                apply: (compiler) => {
                    compiler.hooks.thisCompilation.tap('GenerateVersionFile', (compilation) => {
                        compilation.hooks.processAssets.tap(
                            {
                                name: 'GenerateVersionFile',
                                stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                            },
                            (assets) => {
                                const content = JSON.stringify({ version: appVersion }, null, 2);
                                assets['public/conf/version.json'] = new webpack.sources.RawSource(content);
                            }
                        );
                    });
                }
            }
        ],
        resolve: {
            alias: {
                'leaflet.motion': fileURLToPath(import.meta.resolve('leaflet.motion/dist/leaflet.motion.min.js')),
            }
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].bundle.js',
            chunkFilename: 'js/[name].[contenthash:8].js',
            assetModuleFilename: 'images/[hash][ext][query]',
            clean: true,
            publicPath: '/',
        }
    };
};
