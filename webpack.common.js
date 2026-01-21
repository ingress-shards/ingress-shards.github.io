import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
import fs from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolvePackage = (pkg) => path.dirname(fileURLToPath(import.meta.resolve(`${pkg}/package.json`)));

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
let gitCommitHash = '';
try {
    gitCommitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
    console.warn('Could not get git commit hash: ', e);
}

// eslint-disable-next-line no-unused-vars
export default (env) => {
    const appVersion = gitCommitHash ? `${packageJson.version}-${gitCommitHash}` : packageJson.version;

    return {
        entry: './src/js/index.js',
        module: {
            rules: [
                {
                    test: path.resolve(__dirname, 'src/data/json-parser-worker.js'),
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
                    test: /\.(png|svg|jpg|jpeg|gif)$/i,
                    type: 'asset/resource',
                },
                {
                    test: /\.(woff|woff2|eot|ttf|otf)$/i,
                    type: 'asset/resource',
                    generator: {
                        filename: 'fonts/[name][ext]',
                    },
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                __APP_VERSION__: JSON.stringify(appVersion),
            }),
            new HtmlWebpackPlugin({
                template: './index.html',
                favicon: './src/assets/abaddon1_shard.png',
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
            assetModuleFilename: 'images/[hash][ext][query]',
            clean: true,
            publicPath: '/',
        }
    };
};
