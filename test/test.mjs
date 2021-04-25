import { test } from 'uvu'
import * as assert from 'uvu/assert'
import snapshot from './helpers/snapshot.mjs'

import { readFileSync } from 'fs'
import { execSync } from 'child_process'

import Database from '../src/client.mjs'

const DIR = 'test/assets'
const port = 39799

test.before(ctx => {
  Database._reset()
  execSync(`rm -rf ${DIR};mkdir ${DIR}`)
  ctx.dbnum = 1
})

test.after(async t => {
  execSync(`rm -rf ${DIR}`)
})

test.before.each(ctx => {
  ctx.file = `${DIR}/test-${ctx.dbnum++}.db`
})

test('basic', async ctx => {
  const filename = ctx.file
  const db = new Database({ port, filename })
  await db.insert({ _id: 1, foo: 'bar', ignoreThis: undefined })
  await db.ensureIndex({ fieldName: 'foo', sparse: true })

  snapshot('basic.txt', readFileSync(ctx.file, 'utf8'))
})

test('full activity', async ctx => {
  const filename = ctx.file
  const db = new Database({ port, filename })
  const date = new Date(2018, 0, 19, 12, 34, 56)
  await db.insert({ _id: 1, foo: 'bar', date })
  let r
  r = await db.find('_id', 1)
  assert.is(r.foo, 'bar')
  r = await db.findOne('_id', 1)
  assert.is(r.foo, 'bar')
  assert.ok(r.date instanceof Date)
  assert.equal(r.date, date)

  await db.ensureIndex({ fieldName: 'foo', sparse: true })
  await db.ensureIndex({ fieldName: 'foo', sparse: true })
  r = await db.find('foo', 'bar')
  assert.is(r[0]._id, 1)

  r = await db.findOne('foo', 'bar')
  assert.is(r._id, 1)

  await db.insert({ _id: 2, foo: 'bar' })
  r = await db.find('foo', 'bar')
  assert.is(r.length, 2)

  await db.update({ _id: 1, bar: 'quux' })
  r = await db.find('foo', 'bar')
  assert.is(r.length, 1)

  await db.delete({ _id: 1 })

  await db.deleteIndex('foo')
  await db.deleteIndex('_id')

  snapshot('full-activity.txt', readFileSync(ctx.file, 'utf8'))

  await db.ensureIndex({ fieldName: 'foo', sparse: true })
  await db.compact()

  await db.insert({ noId: true })
  assert.is((await db.getAll()).length, 2)
})

test('empty data', async ctx => {
  const filename = ctx.file
  const db = new Database({ port, filename })
  assert.is(await db.findOne('_id', 1), undefined)
  assert.is(await db.find('_id', 1), undefined)
  await db.ensureIndex({ fieldName: 'foo' })
  assert.is(await db.findOne('foo', 1), undefined)
  assert.equal(await db.find('foo', 1), [])
})

test('array indexes', async ctx => {
  const filename = ctx.file
  const db = new Database({ port, filename })
  await db.ensureIndex({ fieldName: 'foo' })
  await db.insert({ _id: 1, foo: ['bar', 'baz'] })
  await db.insert({ _id: 2, foo: ['bar', 'bar'] })
  let r = await db.find('foo', 'bar')
  assert.is(r.length, 2)
  r = await db.find('foo', 'baz')
  assert.is(r.length, 1)

  await db.update({ _id: 1, foo: 'bar' })
  r = await db.find('foo', 'baz')
  assert.is(r.length, 0)
})

test('errors', async ctx => {
  const filename = ctx.file
  const db = new Database({ port, filename })
  db.delete({ _id: 1 }).then(assert.unreachable, err =>
    assert.instance(err, Database.NotExists)
  )
  db.update({ _id: 1 }).then(assert.unreachable, err =>
    assert.instance(err, Database.NotExists)
  )

  await db.insert({ _id: 'foo', bar: 'baz' })
  db.insert({ _id: 'foo', bar: 'baz' }).then(assert.unreachable, err =>
    assert.instance(err, Database.KeyViolation)
  )

  await db.ensureIndex({ fieldName: 'foo', unique: true })
  await db.insert({ _id: 1, foo: 'bar' })
  db.insert({ _id: 2, foo: 'bar' }).then(assert.unreachable, err =>
    assert.instance(err, Database.KeyViolation)
  )

  await db.insert({ _id: 2, foo: 'baz' })
  db.update({ _id: 1, foo: 'baz' }).then(assert.unreachable, err =>
    assert.instance(err, Database.KeyViolation)
  )

  db.find('bar', 'quux').then(assert.unreachable, err =>
    assert.instance(err, Database.NoIndex)
  )
})

test.run()
