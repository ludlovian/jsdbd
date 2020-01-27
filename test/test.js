'use strict'
import test from 'ava'
import Database from '../src/client'
import fs from 'fs'
import { promisify } from 'util'
import { exec as _exec } from 'child_process'

const readFile = promisify(fs.readFile)
const exec = promisify(_exec)

const DIR = './test-dbs~'
const port = 39799

test.before(async t => {
  await exec(`rm -rf ${DIR};mkdir ${DIR}`)
})

test.serial.after(async t => {
  await exec(`rm -rf ${DIR}`)
})

test.beforeEach(t => {
  t.context.file = `${DIR}/test-${Math.random()
    .toString(36)
    .slice(2, 10)}.db`
})

test('basic', async t => {
  const filename = t.context.file
  const db = new Database({ port, filename })
  await db.insert({ _id: 1, foo: 'bar', ignoreThis: undefined })
  await db.ensureIndex({ fieldName: 'foo', sparse: true })
  const file = await readFile(filename, 'utf8')
  t.snapshot(file)
})

test('full activity', async t => {
  const filename = t.context.file
  const db = new Database({ port, filename })
  const date = new Date(2018, 0, 19, 12, 34, 56)
  await db.insert({ _id: 1, foo: 'bar', date })
  let r
  r = await db.find('_id', 1)
  t.is(r.foo, 'bar')
  r = await db.findOne('_id', 1)
  t.is(r.foo, 'bar')
  t.true(r.date instanceof Date)
  t.deepEqual(r.date, date)

  await db.ensureIndex({ fieldName: 'foo', sparse: true })
  await db.ensureIndex({ fieldName: 'foo', sparse: true })
  r = await db.find('foo', 'bar')
  t.is(r[0]._id, 1)

  r = await db.findOne('foo', 'bar')
  t.is(r._id, 1)

  await db.insert({ _id: 2, foo: 'bar' })
  r = await db.find('foo', 'bar')
  t.is(r.length, 2)

  await db.update({ _id: 1, bar: 'quux' })
  r = await db.find('foo', 'bar')
  t.is(r.length, 1)

  await db.delete({ _id: 1 })

  await db.deleteIndex('foo')
  await db.deleteIndex('_id')

  const file = await readFile(t.context.file, 'utf8')
  t.snapshot(file)

  await db.ensureIndex({ fieldName: 'foo', sparse: true })
  await db.compact()

  await db.insert({ noId: true })
  t.is((await db.getAll()).length, 2)
})

test('empty data', async t => {
  const filename = t.context.file
  const db = new Database({ port, filename })
  t.is(await db.findOne('_id', 1), undefined)
  t.is(await db.find('_id', 1), undefined)
  await db.ensureIndex({ fieldName: 'foo' })
  t.is(await db.findOne('foo', 1), undefined)
  t.deepEqual(await db.find('foo', 1), [])
})

test('array indexes', async t => {
  const filename = t.context.file
  const db = new Database({ port, filename })
  await db.ensureIndex({ fieldName: 'foo' })
  await db.insert({ _id: 1, foo: ['bar', 'baz'] })
  await db.insert({ _id: 2, foo: ['bar', 'bar'] })
  let r = await db.find('foo', 'bar')
  t.is(r.length, 2)
  r = await db.find('foo', 'baz')
  t.is(r.length, 1)

  await db.update({ _id: 1, foo: 'bar' })
  r = await db.find('foo', 'baz')
  t.is(r.length, 0)
})

test('errors', async t => {
  const filename = t.context.file
  const db = new Database({ port, filename })
  await t.throwsAsync(() => db.delete({ _id: 1 }), {
    instanceOf: Database.NotExists
  })
  await t.throwsAsync(() => db.update({ _id: 1 }), {
    instanceOf: Database.NotExists
  })

  await db.insert({ _id: 'foo', bar: 'baz' })
  await t.throwsAsync(() => db.insert({ _id: 'foo', bar: 'baz' }), {
    instanceOf: Database.KeyViolation
  })

  await db.ensureIndex({ fieldName: 'foo', unique: true })
  await db.insert({ _id: 1, foo: 'bar' })
  await t.throwsAsync(() => db.insert({ _id: 2, foo: 'bar' }), {
    instanceOf: Database.KeyViolation
  })

  await db.insert({ _id: 2, foo: 'baz' })
  await t.throwsAsync(() => db.update({ _id: 1, foo: 'baz' }), {
    instanceOf: Database.KeyViolation
  })

  await t.throwsAsync(() => db.find('bar', 'quux'), {
    instanceOf: Database.NoIndex
  })
})
