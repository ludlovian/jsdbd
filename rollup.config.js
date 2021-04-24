import resolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'

export default [
  {
    input: 'src/jsdbd.mjs',
    external: [ 'sade', 'ms' ],
    plugins: [
      resolve(),
      replace({
        preventAssignment: true,
        values: {
          __VERSION__: process.env.npm_package_version
        }
      })
    ],
    output: [
      {
        file: 'dist/jsdbd.mjs',
        format: 'esm',
        sourcemap: false,
        banner: '#!/usr/bin/env node'
      }
    ]
  }
]
