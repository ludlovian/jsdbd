'use strict'

import RpcClient from 'jsrpc/client'
import { jsdbMethods, jsdbErrors } from './util.mjs'

let client

const staticMethods = ['status', 'housekeep', 'clear', 'shutdown']

export default class Database {
  constructor (opts) {
    /* c8 ignore next 2 */
    if (typeof opts === 'string') opts = { filename: opts }
    const { port = 39720, ...options } = opts
    this.options = options
    if (!client) {
      client = new RpcClient({ port })
      for (const method of staticMethods) {
        Database[method] = client.call.bind(client, method)
      }
    }
    const { filename } = this.options
    for (const method of jsdbMethods.values()) {
      this[method] = client.call.bind(client, 'dispatch', filename, method)
    }
  }

  async check () {
    try {
      await client.call('status')
      /* c8 ignore next 6 */
    } catch (err) {
      if (err.code === 'ECONNREFUSED') {
        throw new NoServer(err)
      } else {
        throw err
      }
    }
  }
}

class NoServer extends Error {
  constructor (err) {
    super('Could not find jsdbd')
    Object.assign(this, err, { client })
  }
}

Database.NoServer = NoServer

jsdbErrors.forEach(name => {
  Database[name] = RpcClient.error(name)
})
