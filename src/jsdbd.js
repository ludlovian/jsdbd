#!/usr/bin/env node
'use strict'

import JsdbServer from './server'
import mri from 'mri'
import { version } from '../package.json'

main()

function main () {
  const options = readOptions()
  if (options.help) return showHelp()
  const server = new JsdbServer(options)
  const stop = server.stop.bind(server)
  const reloadAll = server.reloadAll.bind(server)
  process.on('SIGTERM', stop).on('SIGINT', stop)
  process.on('SIGUSR1', reloadAll)
  return server.start()
}

function readOptions () {
  const alias = { h: 'help', t: 'timeout', p: 'port', l: 'log', b: 'base' }
  const args = mri(process.argv.slice(2), { alias })
  return {
    idleTimeout: args.timeout,
    port: args.port,
    log: !!args.log,
    base: args.base,
    help: args.help
  }
}

function showHelp () {
  console.log(
    `jsdbd v${version}\n\n` +
      `Runs a jsdb daemon. Options:\n` +
      `-t --timeout <ms>  Set the idle timeout (in ms) for the daemon to exit\n` +
      `-p --port <n>      Set the port to listen on\n` +
      `-b --base <dir>    Sets the base dir for database files\n` +
      `-l --log           Turns on logging of calls to stdout\n`
  )
}
