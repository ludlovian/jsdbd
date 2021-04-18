'use strict'
import test from 'ava'
import Database from '../src/client'

test('check server', async t => {
  const db = new Database({ port: 39798 })
  await t.throwsAsync(() => db.check(), {
    instanceOf: Database.NoServer
  })
})
