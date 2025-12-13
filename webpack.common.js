import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-disable-next-line no-unused-vars
export default (env) => {
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
                        path.resolve(__dirname, 'node_modules', 'flag-icon-css')
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
                        path.resolve(__dirname, 'node_modules', 'flag-icon-css')
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
                        from: path.resolve(__dirname, 'node_modules/leaflet/dist/images'),
                        to: 'images/markers',
                    },
                    {
                        from: "node_modules/flag-icon-css/flags/4x3",
                        to: "flags/4x3",
                    },
                    {
                        from: "node_modules/flag-icon-css/flags/1x1",
                        to: "flags/1x1",
                    },
                ]
            })
        ],
        resolve: {
            alias: {
                'leaflet.motion': path.resolve(__dirname, 'node_modules/leaflet.motion/dist/leaflet.motion.min.js'),
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
