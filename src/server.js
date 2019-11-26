'use strict'

import { RpcServer } from 'jsrpc'
import Datastore from 'jsdb'
import { resolve } from 'path'

import { jsdbMethods } from './util'

let tick

export default class JsdbServer extends RpcServer {
  constructor ({ files = '.', idleTime = 30 * 60, ...options }) {
    super(options)
    files = resolve(files)

    Object.assign(this, { files, idleTime })

    this.openDatabases = new Map()
    this.handle('shutdown', shutdown.bind(this))
      .handle('status', status.bind(this))
      .handle('dispatch', dispatch.bind(this))
      .handle('housekeep', housekeep.bind(this))
      .handle('clear', clear.bind(this))

    setInterval(housekeep.bind(this), idleTime * 1000).unref()

    startClock()
  }
}

function startClock () {
  if (tick != null) return
  tick = 0
  setInterval(() => tick++, 1000).unref()
}

function shutdown () {
  setTimeout(() => this.stop(5000))
}

function status () {
  return {
    tick,
    files: this.files,
    databases: Array.from(this.openDatabases.entries()).map(
      ([name, { db, tick }]) => ({ name, tick })
    )
  }
}

function housekeep () {
  Array.from(this.openDatabases.entries()).forEach(
    ([filename, { tick: lastTick, db }]) => {
      if (tick - lastTick > this.idleTime) {
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
  const db = getDatabase.call(this, filename)
  if (!db.loaded) await db.load()
  return db[method](...args)
}

function getDatabase (filename) {
  const data = this.openDatabases.get(filename)
  if (data) {
    data.tick = tick
    return data.db
  }

  const db = new Datastore({ filename })
  this.openDatabases.set(filename, { db, tick })
  return db
}
