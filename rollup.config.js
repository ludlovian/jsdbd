import { terser } from 'rollup-plugin-terser'
import cleanup from 'rollup-plugin-cleanup'
import hashbang from 'rollup-plugin-hashbang'
import resolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import json from 'rollup-plugin-json'

export default [
  {
    input: 'src/jsdbd.js',
    external: ['util', 'http', 'https', 'fs', 'path'],
    plugins: [
      hashbang(),
      json(),
      resolve(),
      commonjs(),
      cleanup(),
      terser()
    ],
    output: [
      {
        file: 'dist/jsdbd',
        format: 'cjs',
        sourcemap: false,
      }
    ]
  },
  {
    input: 'src/client.js',
    external: ['jsrpc/client', 'child_process', 'net'],
    plugins: [
      cleanup(),
      process.env.NODE_ENV === 'production' && terser()
    ],
    output: [
      {
        file: 'dist/client.js',
        format: 'cjs',
        sourcemap: false,
      },
      {
        file: 'dist/client.mjs',
        format: 'esm',
        sourcemap: false
      }
    ]
  }
]

