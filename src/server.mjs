import { resolve } from 'path'
import ms from 'ms'

import Database from 'jsdb'
import RpcServer from 'jsrpc/server'
import { jsdbMethods } from './util.mjs'

export default class JsdbServer extends RpcServer {
  constructor ({ files = '.', idleTime = '30m', ...options }) {
    super(options)
    files = resolve(files)
    idleTime = ms(idleTime + '')
    const startTime = Date.now()

    Object.assign(this, { files, idleTime, startTime })

    this.openDatabases = new Map()
    this.handle('shutdown', shutdown.bind(this))
      .handle('status', status.bind(this))
      .handle('dispatch', dispatch.bind(this))
      .handle('housekeep', housekeep.bind(this))
      .handle('clear', clear.bind(this))

    setInterval(housekeep.bind(this), idleTime).unref()
  }
}

function shutdown () {
  setTimeout(() => this.stop(5000))
}

function status () {
  const now = Date.now()
  return {
    uptime: now - this.startTime,
    idleTime: this.idleTime,
    files: this.files,
    databases: Array.from(this.openDatabases.entries()).map(
      ([name, { db, lastTouch }]) => ({ name, uptime: now - lastTouch })
    )
  }
}

function housekeep () {
  const now = Date.now()
  Array.from(this.openDatabases.entries()).forEach(
    ([filename, { lastTouch }]) => {
      if (now - lastTouch > this.idleTime) {
        this.openDatabases.delete(filename)
      }
    }
  )
}

function clear () {
  this.openDatabases.clear()
}

async function dispatch (filename, method, ...args) {
  if (!jsdbMethods.has(method)) {
    throw new Error(`Unknown method: ${method}`)
  }

  // we have to find the database
  filename = resolve(this.files, filename)
  const lastTouch = Date.now()
  let db
  const rec = this.openDatabases.get(filename)
  if (rec) {
    rec.lastTouch = lastTouch
    db = rec.db
  } else {
    db = new Database(filename)
    this.openDatabases.set(filename, { db, lastTouch })
  }

  if (!db.loaded) await db.load()
  return db[method](...args)
}
