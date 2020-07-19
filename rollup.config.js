import { terser } from 'rollup-plugin-terser'
import cleanup from 'rollup-plugin-cleanup'
import resolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import json from 'rollup-plugin-json'

export default [
  {
    input: 'src/jsdbd.js',
    external: [
      'util',
      'http',
      'https',
      'fs',
      'path',
      'child_process',
      'net',
      'events',
      'os'
    ],
    plugins: [json(), resolve(), commonjs(), cleanup(), terser()],
    output: [
      {
        file: 'dist/jsdbd',
        format: 'cjs',
        sourcemap: false,
        banner: '#!/usr/bin/env node'
      }
    ]
  },
  {
    input: 'src/client.js',
    external: ['jsrpc', 'child_process', 'net'],
    plugins: [cleanup(), process.env.NODE_ENV === 'production' && terser()],
    output: [
      {
        file: 'dist/client.js',
        format: 'cjs',
        exports: 'default',
        sourcemap: false
      },
      {
        file: 'dist/client.mjs',
        format: 'esm',
        sourcemap: false
      }
    ]
  }
]
