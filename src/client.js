'use strict'

import { RpcClient } from 'jsrpc'
import { jsdbMethods } from './util'

let client

const staticMethods = ['status', 'housekeep', 'clear', 'shutdown']

export default class Database {
  constructor (opts) {
    // istanbul ignore if
    if (typeof opts === 'string') opts = { filename: opts }
    // istanbul ignore next
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
}
