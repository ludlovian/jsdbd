'use strict'

import RpcServer from 'jsrpc/server'
import Datastore from 'jsdb'

export default class JsdbServer extends RpcServer {
  constructor (options) {
    super(options)

    this._dbs = new Map()
    for (const method of METHODS) {
      this.on(method, this[method].bind(this))
    }

    if (options.log) this.log = console.log.bind(console)
  }

  async connect (options) {
    if (typeof options === 'string') options = { filename: options }
    const { filename } = options
    if (!this._dbs.has(filename)) {
      const db = new Datastore(options)
      await db.load()
      this._dbs.set(filename, db)
    }

    const db = this._dbs.get(filename)
    return Object.values(db.indexes).map(ix => ix.options)
  }

  async getAll (filename) {
    return this._dbs.get(filename).getAll()
  }

  async insert (filename, doc) {
    return this._dbs.get(filename).insert(doc)
  }

  async update (filename, doc) {
    return this._dbs.get(filename).update(doc)
  }

  async delete (filename, doc) {
    return this._dbs.get(filename).delete(doc)
  }

  async ensureIndex (filename, options) {
    return this._dbs.get(filename).ensureIndex(options)
  }

  async deleteIndex (filename, fieldName) {
    return this._dbs.get(filename).deleteIndex(fieldName)
  }

  async compact (filename) {
    return this._dbs.get(filename).compact()
  }

  async setAutoCompaction (filename, interval) {
    return this._dbs.get(filename).setAutoCompaction(interval)
  }

  async stopAutoCompaction (filename) {
    return this._dbs.get(filename).stopAutoCompaction()
  }

  async indexFind (filename, ix, value) {
    return this._dbs.get(filename).indexes[ix].find(value)
  }

  async indexFindOne (filename, ix, value) {
    return this._dbs.get(filename).indexes[ix].findOne(value)
  }

  async indexGetAll (filename, ix) {
    return this._dbs.get(filename).indexes[ix].getAll()
  }
}

const METHODS = [
  'connect',
  'getAll',
  'insert',
  'update',
  'delete',
  'ensureIndex',
  'deleteIndex',
  'compact',
  'setAutoCompaction',
  'stopAutoCompaction',
  'indexFind',
  'indexFindOne',
  'indexGetAll'
]
