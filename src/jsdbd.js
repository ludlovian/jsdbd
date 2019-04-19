#!/usr/bin/env node
'use strict'

import JsdbServer from './server'
import mri from 'mri'

main()

function main () {
  const options = readOptions()
  const server = new JsdbServer(options)
  const stop = server.stop.bind(server)
  process.on('SIGTERM', stop).on('SIGINT', stop)
  return server.start()
}

function readOptions () {
  const alias = { t: 'timeout', p: 'port', l: 'log' }
  const args = mri(process.argv.slice(2), { alias })
  return {
    idleTimeout: args.timeout,
    port: args.port,
    log: !!args.log
  }
}
