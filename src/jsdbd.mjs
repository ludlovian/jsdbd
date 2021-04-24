import { resolve } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'

import ms from 'ms'
import sade from 'sade'

import RpcClient from 'jsrpc/client'

import JsdbServer from './server.mjs'
import { wrap, portActive } from './util.mjs'

const version = '__VERSION__'
const prog = sade('jsdbd')

const DEFAULT_FILES = resolve(homedir(), '.databases')

prog.version(version).option('--port, -p', 'The port to use', 39720)

prog
  .command('status', 'shows the status of the jsdbd daemon', { default: true })
  .action(wrap(showStatus))

prog
  .command('start', 'starts the server')
  .option('-f, --files', 'where files area stored', DEFAULT_FILES)
  .option('-s, --silent', 'be quiet')
  .option('--idle-time', 'cleaning interval', '30m')
  .action(wrap(startServer))

prog.command('clear', 'closes all databases').action(wrap(clearServer))

prog.command('stop', 'stops the server').action(wrap(stopServer))

prog
  .command('__server', 'runs the server (internal use)')
  .action(wrap(runServer))

prog.parse(process.argv, {
  alias: {
    idleTime: 'idle-time'
  }
})

async function startServer (opts) {
  let { files, idleTime, port, silent } = opts
  files = resolve(files)

  if (await portActive(port)) {
    if (!silent) console.log(`Server already active on port ${port}`)
    return
  }

  const cmd = process.execPath
  const args = [
    ...process.execArgv,
    process.argv[1],
    '__server',
    '--port',
    port,
    '--files',
    files,
    '--idle-time',
    idleTime
  ]
  const spawnOpts = {
    stdio: 'ignore',
    detached: true
  }
  spawn(cmd, args, spawnOpts).unref()
  if (!silent) console.log(`Serving databases in ${files} on port ${port}`)
}

function runServer (opts) {
  const { idleTime, files, port } = opts
  const server = new JsdbServer({ idleTime, files, port })
  const shutdown = () => server.stop()
  process.on('SIGINT', shutdown).on('SIGTERM', shutdown)
  return server.start()
}

async function showStatus ({ port }) {
  const status = await sendCommand({ port }, 'status')
  console.log(`jsdb server running on port ${port}\n`)
  console.log(`Uptime: ${ms(status.uptime, { long: true })}`)
  console.log(`Housekeep every ${ms(status.idleTime)}`)
  console.log(`Database files: ${status.files}\n`)
  const { databases } = status
  if (!databases.length) {
    console.log('No databases open')
    return
  }
  console.log('Databases open:')
  for (const { name, uptime } of databases) {
    console.log(`  ${name} (${ms(uptime, { long: true })})`)
  }
}

async function stopServer ({ port }) {
  await sendCommand({ port }, 'shutdown')
  console.log(`Server on port ${port} shut down`)
}

async function clearServer ({ port }) {
  await sendCommand({ port }, 'clear')
  console.log(`All databases cleared on port ${port}`)
}

async function sendCommand ({ port }, method, ...args) {
  if (!(await portActive(port))) {
    console.log(`No server active on port ${port}`)
    process.exit(1)
  }

  const client = new RpcClient({ port })
  return client.call(method, ...args)
}
