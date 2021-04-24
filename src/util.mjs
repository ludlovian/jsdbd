'use strict'

import { createConnection } from 'net'

/* c8 ignore start */
export function portActive (port) {
  return new Promise((resolve, reject) => {
    const tm = setTimeout(
      () => reject(new Error('timed out connecting to server')),
      500
    )
    const conn = createConnection(port, () => {
      clearTimeout(tm)
      setImmediate(() => {
        conn.destroy()
        resolve(true)
      })
    })
    conn.once('error', () => {
      clearTimeout(tm)
      resolve(false)
    })
  })
}
/* c8 ignore end */

export function wrap (fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch(err => {
        console.error(err)
        process.exit(2)
      })
}

export function getRoughTime (n) {
  if (n <= 90) return `${n} seconds`
  n = Math.round(n / 60)
  if (n <= 90) return `${n} minutes`
  n = Math.round(n / 60)
  if (n <= 36) return `${n} hours`
  n = Math.round(n / 24)
  return `${n.toLocaleString()} days`
}

export const jsdbMethods = new Set([
  'ensureIndex',
  'deleteIndex',
  'insert',
  'update',
  'upsert',
  'delete',
  'find',
  'findOne',
  'getAll',
  'compact',
  'reload'
])

export const jsdbErrors = new Set(['KeyViolation', 'NotExists', 'NoIndex'])
