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

const secretsPath = path.resolve(__dirname, '.secrets');
if (fs.existsSync(secretsPath)) {
    const secretsContent = fs.readFileSync(secretsPath, 'utf-8');
    for (const line of secretsContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [key, ...rest] = trimmed.split('=');
            const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
            if (!process.env[key.trim()]) {
                process.env[key.trim()] = val;
            }
        }
    }
}

export default (env, { appVersion }) => {
    const leafletDir = resolvePackage('leaflet');
    const maplibreDistDir = path.join(resolvePackage('maplibre-gl'), 'dist');

    return {
        entry: './src/js/index.js',
        cache: {
            type: 'filesystem',
            buildDependencies: {
                config: [
                    fileURLToPath(import.meta.url),
                    path.resolve(__dirname, 'webpack.dev.js'),
                    path.resolve(__dirname, 'webpack.prod.js'),
                ],
            },
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                        },
                    },
                    exclude: /node_modules/,
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
                        path.resolve(__dirname, 'gen/flags')
                    ],
                    type: 'asset/resource',
                    generator: {
                        filename: 'images/flag-icons/[name].[contenthash:8][ext]',
                    },
                },
                {
                    test: /\.(png|svg|jpg|jpeg|gif)$/i,
                    exclude: [
                        path.resolve(__dirname, 'gen/flags'),
                        /abaddon1_shard\.png$/,
                        leafletDir
                    ],
                    type: 'asset/resource',
                    generator: {
                        filename: 'images/[name].[contenthash:8][ext]',
                    },
                },
                // Leaflet markers are copied manually in CopyWebpackPlugin below so the full set (shadows, @2x) is present.
                // This rule handles URL resolution for markers explicitly imported or referenced in CSS without re-emitting them.
                {
                    test: /\.(png|svg|jpg|jpeg|gif)$/i,
                    include: [
                        leafletDir
                    ],
                    type: 'asset/resource',
                    generator: {
                        filename: 'images/markers/[name][ext]',
                        emit: false,
                    },
                },

                // Prevent Webpack from trying to statically resolve MapLibre's runtime `new URL(url, import.meta.url)` worker helper.
                {
                    test: /\.mjs$/,
                    include: [
                        maplibreDistDir
                    ],
                    parser: {
                        url: false,
                    },
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                __APP_VERSION__: JSON.stringify(appVersion),
                __CARTO_API_KEY__: JSON.stringify(process.env.CARTO_API_KEY || ''),
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
                        from: path.join(maplibreDistDir, 'maplibre-gl-worker.mjs'),
                        to: 'js/maplibre-gl-worker.mjs',
                    },
                    {
                        from: path.join(maplibreDistDir, 'maplibre-gl-shared.mjs'),
                        to: 'js/maplibre-gl-shared.mjs',
                    },
                    {
                        from: path.join(leafletDir, 'dist', 'images'),
                        to: 'images/markers',
                    },
                    {
                        from: path.resolve(__dirname, 'gen/data'),
                        to: 'data/',
                        noErrorOnMissing: true,
                    },
                    {
                        from: path.resolve(__dirname, 'docs/assets/shard-site.png'),
                        to: 'images/',
                    },
                    {
                        from: path.resolve(__dirname, 'src/images/ornament-icons'),
                        to: 'images/ornament-icons',
                    },
                ]
            }),
        ],
        resolve: {
            extensions: ['.ts', '.js', '.json'],
            extensionAlias: {
                '.js': ['.ts', '.js'],
            },
            alias: {
                'leaflet.motion': fileURLToPath(import.meta.resolve('leaflet.motion/dist/leaflet.motion.min.js')),
            }
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].bundle.js',
            chunkFilename: '[name].chunk.js',
            assetModuleFilename: 'images/[hash][ext][query]',
            clean: true,
            publicPath: '/',
        }
    };
};
