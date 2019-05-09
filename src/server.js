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

    const db = this.db(filename)
    return Object.values(db.indexes).map(ix => ix.options)
  }

  reloadAll () {
    this.log('reload')
    return Promise.all(Array.from(this._dbs.values()).map(db => db.reload()))
  }

  stopServer () {
    setTimeout(() => this.stop())
  }

  db (filename) {
    const _db = this._dbs.get(filename)
    if (!_db) throw new Error(`Not connected to database at: ${filename}`)
    return _db
  }

  async getAll (filename) {
    return this.db(filename).getAll()
  }

  async insert (filename, doc) {
    return this.db(filename).insert(doc)
  }

  async update (filename, doc) {
    return this.db(filename).update(doc)
  }

  async delete (filename, doc) {
    return this.db(filename).delete(doc)
  }

  async ensureIndex (filename, options) {
    return this.db(filename).ensureIndex(options)
  }

  async deleteIndex (filename, fieldName) {
    return this.db(filename).deleteIndex(fieldName)
  }

  async compact (filename) {
    return this.db(filename).compact()
  }

  async setAutoCompaction (filename, interval) {
    return this.db(filename).setAutoCompaction(interval)
  }

  async stopAutoCompaction (filename) {
    return this.db(filename).stopAutoCompaction()
  }

  async indexFind (filename, ix, value) {
    return this.db(filename).indexes[ix].find(value)
  }

  async indexFindOne (filename, ix, value) {
    return this.db(filename).indexes[ix].findOne(value)
  }

  async indexGetAll (filename, ix) {
    return this.db(filename).indexes[ix].getAll()
  }
}

const METHODS = [
  'connect',
  'reloadAll',
  'stopServer',
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
