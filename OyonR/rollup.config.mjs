import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const externalDeps = ['@mediapipe/tasks-vision', 'onnxruntime-web', 'react', 'react-dom', 'webeyetrack', 'webgazer'];
const isExternal = id => externalDeps.some(dep => id === dep || id.startsWith(`${dep}/`));

const banner = `/*! oyon v${process.env.npm_package_version || '0.0.0'} | MIT | https://github.com/mohsaqr/Oyon */`;

export default [
  {
    input: 'src/index.js',
    external: isExternal,
    plugins: [nodeResolve({ preferBuiltins: false })],
    output: [
      {
        file: 'dist/oyon.esm.js',
        format: 'es',
        sourcemap: true,
        banner,
      },
    ],
  },
  {
    input: 'src/index.js',
    external: isExternal,
    plugins: [nodeResolve({ preferBuiltins: false })],
    output: [
      {
        file: 'dist/oyon.umd.js',
        format: 'umd',
        name: 'Oyon',
        sourcemap: true,
        banner,
        globals: {
          '@mediapipe/tasks-vision': 'MediaPipeTasksVision',
          'onnxruntime-web': 'ort',
          react: 'React',
          'react-dom': 'ReactDOM',
          webeyetrack: 'WebEyeTrack',
          webgazer: 'webgazer',
        },
      },
      {
        file: 'dist/oyon.umd.min.js',
        format: 'umd',
        name: 'Oyon',
        sourcemap: true,
        banner,
        plugins: [terser({ format: { comments: /^!/ } })],
        globals: {
          '@mediapipe/tasks-vision': 'MediaPipeTasksVision',
          'onnxruntime-web': 'ort',
          react: 'React',
          'react-dom': 'ReactDOM',
          webeyetrack: 'WebEyeTrack',
          webgazer: 'webgazer',
        },
      },
    ],
  },
];
