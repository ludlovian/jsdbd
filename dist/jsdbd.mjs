#!/usr/bin/env node
import { resolve } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import ms from 'ms';
import sade from 'sade';
import http, { request } from 'http';
import fs from 'fs';
import EventEmitter from 'events';
import { createConnection } from 'net';

function deserialize (obj) {
  if (Array.isArray(obj)) return Object.freeze(obj.map(deserialize))
  if (obj === null || typeof obj !== 'object') return obj
  if ('$$date$$' in obj) return Object.freeze(new Date(obj.$$date$$))
  if ('$$undefined$$' in obj) return undefined
  return Object.freeze(
    Object.entries(obj).reduce(
      (o, [k, v]) => ({ ...o, [k]: deserialize(v) }),
      {}
    )
  )
}

function serialize (obj) {
  if (Array.isArray(obj)) return obj.map(serialize)
  if (obj === undefined) return { $$undefined$$: true }
  if (obj instanceof Date) return { $$date$$: obj.getTime() }
  if (obj === null || typeof obj !== 'object') return obj
  return Object.entries(obj).reduce(
    (o, [k, v]) => ({ ...o, [k]: serialize(v) }),
    {}
  )
}

const jsonrpc = '2.0';

const knownErrors = {};

class RpcClient {
  constructor (options) {
    this.options = options;
  }

  async call (method, ...params) {
    const body = JSON.stringify({
      jsonrpc,
      method,
      params: serialize(params)
    });

    const options = {
      ...this.options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'keep-alive'
      }
    };
    const res = await makeRequest(options, body);
    const data = await readResponse(res);

    if (data.error) {
      const errDetails = deserialize(data.error);
      const Factory = RpcClient.error(errDetails.name);
      throw new Factory(errDetails)
    }

    return deserialize(data.result)
  }

  static error (name) {
    let constructor = knownErrors[name];
    if (constructor) return constructor
    constructor = makeErrorClass(name);
    knownErrors[name] = constructor;
    return constructor
  }
}

function makeRequest (options, body) {
  return new Promise((resolve, reject) => {
    const req = request(options, resolve);
    req.once('error', reject);
    req.write(body);
    req.end();
  })
}

async function readResponse (res) {
  res.setEncoding('utf8');
  let data = '';
  for await (const chunk of res) {
    data += chunk;
  }
  return JSON.parse(data)
}

function makeErrorClass (name) {
  function fn (data) {
    const { name, ...rest } = data;
    Error.call(this);
    Error.captureStackTrace(this, this.constructor);
    Object.assign(this, rest);
  }

  // reset the name of the constructor
  Object.defineProperties(fn, {
    name: { value: name, configurable: true }
  });

  // make it inherit from error
  fn.prototype = Object.create(Error.prototype, {
    name: { value: name, configurable: true },
    constructor: { value: fn, configurable: true }
  });

  return fn
}

class PLock {
  constructor ({ width = 1 } = {}) {
    this.width = width;
    this.count = 0;
    this.awaiters = [];
  }

  acquire () {
    if (this.count < this.width) {
      this.count++;
      return Promise.resolve()
    }
    return new Promise(resolve => this.awaiters.push(resolve))
  }

  release () {
    if (!this.count) return
    if (this.waiting) {
      this.awaiters.shift()();
    } else {
      this.count--;
    }
  }

  get waiting () {
    return this.awaiters.length
  }

  async exec (fn) {
    try {
      await this.acquire();
      return await Promise.resolve(fn())
    } finally {
      this.release();
    }
  }
}

class DatastoreError extends Error {
  constructor (name, message) {
    super(message);
    this.name = name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class KeyViolation extends DatastoreError {
  constructor (doc, fieldName) {
    super('KeyViolation', 'Key violation error');
    this.fieldName = fieldName;
    this.record = doc;
  }
}

class NotExists extends DatastoreError {
  constructor (doc) {
    super('NotExists', 'Record does not exist');
    this.record = doc;
  }
}

class NoIndex extends DatastoreError {
  constructor (fieldName) {
    super('NoIndex', 'No such index');
    this.fieldName = fieldName;
  }
}

function delve (obj, key) {
  let p = 0;
  key = key.split('.');
  while (obj && p < key.length) {
    obj = obj[key[p++]];
  }
  return obj === undefined || p < key.length ? undefined : obj
}

function getId (row, existing) {
  // generate a repeatable for this row, avoiding conflicts with the other rows
  const start = hashString(stringify(row));
  for (let n = 0; n < 1e8; n++) {
    const id = ((start + n) & 0x7fffffff).toString(36);
    if (!existing.has(id)) return id
  }
  // istanbul ignore next
  throw new Error('Could not generate unique id')
}

function hashString (string) {
  return Array.from(string).reduce(
    (h, ch) => ((h << 5) - h + ch.charCodeAt(0)) & 0xffffffff,
    0
  )
}

function cleanObject (obj) {
  return Object.entries(obj).reduce((o, [k, v]) => {
    if (v !== undefined) o[k] = v;
    return o
  }, {})
}

const DATE_SENTINEL = '$date';

function stringify (obj) {
  return JSON.stringify(obj, function (k, v) {
    return this[k] instanceof Date
      ? { [DATE_SENTINEL]: this[k].toISOString() }
      : v
  })
}

function parse (s) {
  return JSON.parse(s, function (k, v) {
    if (k === DATE_SENTINEL) return new Date(v)
    if (typeof v === 'object' && DATE_SENTINEL in v) return v[DATE_SENTINEL]
    return v
  })
}

function sortOn (selector) {
  if (typeof selector !== 'function') {
    const key = selector;
    selector = x => delve(x, key);
  }
  return (a, b) => {
    const x = selector(a);
    const y = selector(b);
    // istanbul ignore next
    return x < y ? -1 : x > y ? 1 : 0
  }
}

// Indexes are maps between values and docs
//
// Generic index is many-to-many
// Unique index is many values to single doc
// Sparse indexes do not index null-ish values
//
class Index {
  static create (options) {
    return new (options.unique ? UniqueIndex : Index)(options)
  }

  constructor (options) {
    this.options = options;
    this.data = new Map();
  }

  find (value) {
    const docs = this.data.get(value);
    return docs ? Array.from(docs) : []
  }

  findOne (value) {
    const docs = this.data.get(value);
    return docs ? docs.values().next().value : undefined
  }

  addDoc (doc) {
    const value = delve(doc, this.options.fieldName);
    if (Array.isArray(value)) {
      value.forEach(v => this.linkValueToDoc(v, doc));
    } else {
      this.linkValueToDoc(value, doc);
    }
  }

  removeDoc (doc) {
    const value = delve(doc, this.options.fieldName);
    if (Array.isArray(value)) {
      value.forEach(v => this.unlinkValueFromDoc(v, doc));
    } else {
      this.unlinkValueFromDoc(value, doc);
    }
  }

  linkValueToDoc (value, doc) {
    if (value == null && this.options.sparse) return
    const docs = this.data.get(value);
    if (docs) {
      docs.add(doc);
    } else {
      this.data.set(value, new Set([doc]));
    }
  }

  unlinkValueFromDoc (value, doc) {
    const docs = this.data.get(value);
    if (!docs) return
    docs.delete(doc);
    if (!docs.size) this.data.delete(value);
  }
}

class UniqueIndex extends Index {
  findOne (value) {
    return this.data.get(value)
  }

  find (value) {
    return this.findOne(value)
  }

  linkValueToDoc (value, doc) {
    if (value == null && this.options.sparse) return
    if (this.data.has(value)) {
      throw new KeyViolation(doc, this.options.fieldName)
    }
    this.data.set(value, doc);
  }

  unlinkValueFromDoc (value, doc) {
    if (this.data.get(value) === doc) this.data.delete(value);
  }
}

const { readFile, appendFile, open, rename } = fs.promises;

class Datastore {
  constructor (options) {
    this.options = {
      serialize: stringify,
      deserialize: parse,
      special: {
        deleted: '$$deleted',
        addIndex: '$$addIndex',
        deleteIndex: '$$deleteIndex'
      },
      ...options
    };

    this.empty();
  }

  empty () {
    this.indexes = {
      _id: Index.create({ fieldName: '_id', unique: true })
    };
  }

  async ensureIndex (options) {
    const { fieldName } = options;
    const { addIndex } = this.options.special;
    if (this.hasIndex(fieldName)) return
    this.addIndex(options);
    await this.append([{ [addIndex]: options }]);
  }

  async deleteIndex (fieldName) {
    const { deleteIndex } = this.options.special;
    if (fieldName === '_id') return
    if (!this.hasIndex(fieldName)) throw new NoIndex(fieldName)
    this.removeIndex(fieldName);
    await this.append([{ [deleteIndex]: { fieldName } }]);
  }

  addIndex (options) {
    const { fieldName } = options;
    const ix = Index.create(options);
    this.allDocs().forEach(doc => ix.addDoc(doc));
    this.indexes[fieldName] = ix;
  }

  removeIndex (fieldName) {
    delete this.indexes[fieldName];
  }

  hasIndex (fieldName) {
    return Boolean(this.indexes[fieldName])
  }

  find (fieldName, value) {
    if (!this.hasIndex(fieldName)) throw new NoIndex(fieldName)
    return this.indexes[fieldName].find(value)
  }

  findOne (fieldName, value) {
    if (!this.hasIndex(fieldName)) throw new NoIndex(fieldName)
    return this.indexes[fieldName].findOne(value)
  }

  async upsert (docOrDocs, options) {
    let ret;
    let docs;
    if (Array.isArray(docOrDocs)) {
      ret = docOrDocs.map(doc => this.addDoc(doc, options));
      docs = ret;
    } else {
      ret = this.addDoc(docOrDocs, options);
      docs = [ret];
    }
    await this.append(docs);
    return ret
  }

  async delete (docOrDocs) {
    let ret;
    let docs;
    const { deleted } = this.options.special;
    if (Array.isArray(docOrDocs)) {
      ret = docOrDocs.map(doc => this.removeDoc(doc));
      docs = ret;
    } else {
      ret = this.removeDoc(docOrDocs);
      docs = [ret];
    }
    docs = docs.map(doc => ({ [deleted]: doc }));
    await this.append(docs);
    return ret
  }

  addDoc (doc, { mustExist = false, mustNotExist = false } = {}) {
    const { _id, ...rest } = doc;
    const olddoc = this.indexes._id.findOne(_id);
    if (!olddoc && mustExist) throw new NotExists(doc)
    if (olddoc && mustNotExist) throw new KeyViolation(doc, '_id')

    doc = {
      _id: _id || getId(doc, this.indexes._id.data),
      ...cleanObject(rest)
    };
    Object.freeze(doc);

    const ixs = Object.values(this.indexes);
    try {
      ixs.forEach(ix => {
        if (olddoc) ix.removeDoc(olddoc);
        ix.addDoc(doc);
      });
      return doc
    } catch (err) {
      // to rollback, we remove the new doc from each index. If there is
      // an old one, then we remove that (just in case) and re-add
      ixs.forEach(ix => {
        ix.removeDoc(doc);
        if (olddoc) {
          ix.removeDoc(olddoc);
          ix.addDoc(olddoc);
        }
      });
      throw err
    }
  }

  removeDoc (doc) {
    const ixs = Object.values(this.indexes);
    const olddoc = this.indexes._id.findOne(doc._id);
    if (!olddoc) throw new NotExists(doc)
    ixs.forEach(ix => ix.removeDoc(olddoc));
    return olddoc
  }

  allDocs () {
    return Array.from(this.indexes._id.data.values())
  }

  async hydrate () {
    const {
      filename,
      deserialize,
      special: { deleted, addIndex, deleteIndex }
    } = this.options;

    const data = await readFile(filename, { encoding: 'utf8', flag: 'a+' });

    this.empty();
    for (const line of data.split(/\n/).filter(Boolean)) {
      const doc = deserialize(line);
      if (addIndex in doc) {
        this.addIndex(doc[addIndex]);
      } else if (deleteIndex in doc) {
        this.deleteIndex(doc[deleteIndex].fieldName);
      } else if (deleted in doc) {
        this.removeDoc(doc[deleted]);
      } else {
        this.addDoc(doc);
      }
    }
  }

  async rewrite ({ sorted = false } = {}) {
    const {
      filename,
      serialize,
      special: { addIndex }
    } = this.options;
    const temp = filename + '~';
    const docs = this.allDocs();
    if (sorted) {
      if (typeof sorted !== 'string' && typeof sorted !== 'function') {
        sorted = '_id';
      }
      docs.sort(sortOn(sorted));
    }
    const lines = Object.values(this.indexes)
      .filter(ix => ix.options.fieldName !== '_id')
      .map(ix => ({ [addIndex]: ix.options }))
      .concat(docs)
      .map(doc => serialize(doc) + '\n');
    const fh = await open(temp, 'w');
    await fh.writeFile(lines.join(''), 'utf8');
    await fh.sync();
    await fh.close();
    await rename(temp, filename);
  }

  async append (docs) {
    const { filename, serialize } = this.options;
    const lines = docs.map(doc => serialize(doc) + '\n').join('');
    await appendFile(filename, lines, 'utf8');
  }
}

// Database
//
// The public API of a jsdb database
//
class Database {
  constructor (options) {
    if (typeof options === 'string') options = { filename: options };
    if (!options) throw new TypeError('No options given')

    this.loaded = false;
    const lock = new PLock();

    Object.defineProperties(this, {
      _ds: {
        value: new Datastore(options),
        configurable: true
      },
      _lock: {
        value: lock,
        configurable: true
      },
      _execute: {
        value: lock.exec.bind(lock),
        configurable: true
      },
      _autoCompaction: {
        value: undefined,
        configurable: true,
        writable: true
      }
    });

    this._lock.acquire();
    if (options.autoload) this.load();
    if (options.autocompact) this.setAutoCompaction(options.autocompact);
  }

  async load () {
    if (this.loaded) return
    this.loaded = true;
    await this._ds.hydrate();
    await this._ds.rewrite();
    this._lock.release();
  }

  reload () {
    return this._execute(() => this._ds.hydrate())
  }

  compact (opts) {
    return this._execute(() => this._ds.rewrite(opts))
  }

  ensureIndex (options) {
    return this._execute(() => this._ds.ensureIndex(options))
  }

  deleteIndex (fieldName) {
    return this._execute(() => this._ds.deleteIndex(fieldName))
  }

  insert (docOrDocs) {
    return this._execute(() =>
      this._ds.upsert(docOrDocs, { mustNotExist: true })
    )
  }

  update (docOrDocs) {
    return this._execute(() => this._ds.upsert(docOrDocs, { mustExist: true }))
  }

  upsert (docOrDocs) {
    return this._execute(() => this._ds.upsert(docOrDocs))
  }

  delete (docOrDocs) {
    return this._execute(() => this._ds.delete(docOrDocs))
  }

  getAll () {
    return this._execute(async () => this._ds.allDocs())
  }

  find (fieldName, value) {
    return this._execute(async () => this._ds.find(fieldName, value))
  }

  findOne (fieldName, value) {
    return this._execute(async () => this._ds.findOne(fieldName, value))
  }

  setAutoCompaction (interval, opts) {
    this.stopAutoCompaction();
    this._autoCompaction = setInterval(() => this.compact(opts), interval);
  }

  stopAutoCompaction () {
    if (!this._autoCompaction) return
    clearInterval(this._autoCompaction);
    this._autoCompaction = undefined;
  }
}

Object.assign(Database, { KeyViolation, NotExists, NoIndex });

function stoppable (server) {
  const openRequests = new Map();
  let stopping = false;

  // count the requests as they come in
  server.on('connection', socket => {
    openRequests.set(socket, 0);
    socket.once('close', () => openRequests.delete(socket));
  });

  server.on('request', (req, res) => {
    const { socket } = req;
    openRequests.set(socket, openRequests.get(socket) + 1);
    res.once('finish', () => {
      const others = openRequests.get(socket) - 1;
      openRequests.set(socket, others);
      if (stopping && others === 0) {
        socket.end();
      }
    });
  });

  // create the stop logic. This will half-close
  server.stop = timeout =>
    new Promise((resolve, reject) => {
      if (stopping) return resolve()
      stopping = true;

      let graceful = true;
      let tm;
      // end any idle connections
      Array.from(openRequests).map(([socket, n]) => n || socket.end());

      // request a close
      server.close(err => {
        /* c8 ignore next */
        if (err) return reject(err)
        if (tm) clearTimeout(tm);
        resolve(graceful);
      });

      // schedule a kill
      if (timeout) {
        tm = setTimeout(() => {
          tm = null;
          graceful = false;
          Array.from(openRequests.keys()).map(socket => socket.end());
          setImmediate(() =>
            Array.from(openRequests.keys()).map(socket => socket.destroy())
          );
        }, timeout);
      }
    });
  return server
}

const priv = Symbol('jsrpc');

const JSONRPC = '2.0';

class RpcServer extends EventEmitter {
  constructor (opts) {
    super();
    const { callTimeout, ...options } = opts;
    const methods = {};
    const server = stoppable(http.createServer(handleRequest.bind(this)));
    const started = false;
    Object.defineProperty(this, priv, {
      configurable: true,
      value: { callTimeout, options, methods, server, started }
    });
  }

  static create (options) {
    return new RpcServer(options)
  }

  handle (method, handler) {
    this[priv].methods[method] = handler;
    return this
  }

  start () {
    return new Promise((resolve, reject) => {
      const { started, server, options } = this[priv];
      if (started) return resolve(this)
      server.once('error', reject);
      server.listen(options, err => {
        /* c8 ignore next */
        if (err) return reject(err)
        this[priv].started = true;
        this.emit('start');
        resolve(this);
      });
    })
  }

  get started () {
    return this[priv].started
  }

  get httpServer () {
    return this[priv].server
  }

  async stop () {
    if (!this[priv].started) return
    this[priv].started = false;
    await this[priv].server.stop(5000);
    this.emit('stop');
  }
}

async function handleRequest (req, res) {
  let id;
  try {
    const { methods, callTimeout } = this[priv];
    // read in the request body and validate
    const body = await readBody(req);
    const { id: _id, jsonrpc, method, params: serializedParams } = body;
    id = _id;
    if (jsonrpc !== JSONRPC) throw new BadRequest(body)
    const handler = methods[method];
    if (!handler) throw new MethodNotFound(body)
    if (!Array.isArray(serializedParams)) throw new BadRequest(body)
    const params = deserialize(serializedParams);

    // now call then underlying handler
    this.emit('call', { method, params });
    let p = Promise.resolve(handler.apply(this, params));
    if (callTimeout) p = timeout(p, callTimeout);
    const result = serialize(await p);

    // and return the result
    send(res, 200, { jsonrpc: JSONRPC, result, id });
  } catch (err) {
    // any errors result in a safe error return
    const { name, message } = err;
    const error = serialize({ name, message, ...err });
    send(res, err.status || 500, { jsonrpc: JSONRPC, error, id });
  }
}

function send (res, code, data) {
  data = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json;charset=utf-8',
    'content-length': Buffer.byteLength(data)
  });
  res.end(data);
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req
      .on('error', reject)
      .on('data', chunk => {
        data += chunk;
      })
      .on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new BadRequest(data));
        }
      });
  })
}

function timeout (promise, interval) {
  return new Promise((resolve, reject) => {
    const tm = setTimeout(() => reject(new TimedOut()), interval);
    promise.then(result => {
      clearTimeout(tm);
      resolve(result);
    }, reject);
  })
}

class CustomError extends Error {
  constructor (message, rest) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
    Object.assign(this, rest);
  }
}

class MethodNotFound extends CustomError {
  constructor (body) {
    super('Method not found', { status: 404, body });
  }
}

class BadRequest extends CustomError {
  constructor (body) {
    super('Bad request', { status: 400, body });
  }
}

class TimedOut extends CustomError {
  constructor (body) {
    super('Timed out', { status: 504, body });
  }
}

/* c8 ignore start */
function portActive (port) {
  return new Promise((resolve, reject) => {
    const tm = setTimeout(
      () => reject(new Error('timed out connecting to server')),
      500
    );
    const conn = createConnection(port, () => {
      clearTimeout(tm);
      setImmediate(() => {
        conn.destroy();
        resolve(true);
      });
    });
    conn.once('error', () => {
      clearTimeout(tm);
      resolve(false);
    });
  })
}
/* c8 ignore end */

function wrap (fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch(err => {
        console.error(err);
        process.exit(2);
      })
}

const jsdbMethods = new Set([
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
]);

class JsdbServer extends RpcServer {
  constructor ({ files = '.', idleTime = '30m', ...options }) {
    super(options);
    files = resolve(files);
    idleTime = ms(idleTime + '');
    const startTime = Date.now();

    Object.assign(this, { files, idleTime, startTime });

    this.openDatabases = new Map();
    this.handle('shutdown', shutdown.bind(this))
      .handle('status', status.bind(this))
      .handle('dispatch', dispatch.bind(this))
      .handle('housekeep', housekeep.bind(this))
      .handle('clear', clear.bind(this));

    setInterval(housekeep.bind(this), idleTime).unref();
  }
}

function shutdown () {
  setTimeout(() => this.stop(5000));
}

function status () {
  const now = Date.now();
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
  const now = Date.now();
  Array.from(this.openDatabases.entries()).forEach(
    ([filename, { lastTouch }]) => {
      if (now - lastTouch > this.idleTime) {
        this.openDatabases.delete(filename);
      }
    }
  );
}

function clear () {
  this.openDatabases.clear();
}

async function dispatch (filename, method, ...args) {
  if (!jsdbMethods.has(method)) {
    throw new Error(`Unknown method: ${method}`)
  }

  // we have to find the database
  filename = resolve(this.files, filename);
  const lastTouch = Date.now();
  let db;
  const rec = this.openDatabases.get(filename);
  if (rec) {
    rec.lastTouch = lastTouch;
    db = rec.db;
  } else {
    db = new Database(filename);
    this.openDatabases.set(filename, { db, lastTouch });
  }

  if (!db.loaded) await db.load();
  return db[method](...args)
}

const version = '2.5.0';
const prog = sade('jsdbd');

const DEFAULT_FILES = resolve(homedir(), '.databases');

prog.version(version).option('--port, -p', 'The port to use', 39720);

prog
  .command('status', 'shows the status of the jsdbd daemon', { default: true })
  .action(wrap(showStatus));

prog
  .command('start', 'starts the server')
  .option('-f, --files', 'where files area stored', DEFAULT_FILES)
  .option('-s, --silent', 'be quiet')
  .option('--idle-time', 'cleaning interval', '30m')
  .action(wrap(startServer));

prog.command('clear', 'closes all databases').action(wrap(clearServer));

prog.command('stop', 'stops the server').action(wrap(stopServer));

prog
  .command('__server', 'runs the server (internal use)')
  .action(wrap(runServer));

prog.parse(process.argv, {
  alias: {
    idleTime: 'idle-time'
  }
});

async function startServer (opts) {
  let { files, idleTime, port, silent } = opts;
  files = resolve(files);

  if (await portActive(port)) {
    if (!silent) console.log(`Server already active on port ${port}`);
    return
  }

  const cmd = process.execPath;
  const args = [
    ...process.execArgv,
    process.argv[1],
    '__server',
    '--port',
    port,
    '--files',
    files,
    '--idle-time',
    idleTime
  ];
  const spawnOpts = {
    stdio: 'ignore',
    detached: true
  };
  spawn(cmd, args, spawnOpts).unref();
  if (!silent) console.log(`Serving databases in ${files} on port ${port}`);
}

function runServer (opts) {
  const { idleTime, files, port } = opts;
  const server = new JsdbServer({ idleTime, files, port });
  const shutdown = () => server.stop();
  process.on('SIGINT', shutdown).on('SIGTERM', shutdown);
  return server.start()
}

async function showStatus ({ port }) {
  const status = await sendCommand({ port }, 'status');
  console.log(`jsdb server running on port ${port}\n`);
  console.log(`Uptime: ${ms(status.uptime, { long: true })}`);
  console.log(`Housekeep every ${ms(status.idleTime)}`);
  console.log(`Database files: ${status.files}\n`);
  const { databases } = status;
  if (!databases.length) {
    console.log('No databases open');
    return
  }
  console.log('Databases open:');
  for (const { name, uptime } of databases) {
    console.log(`  ${name} (${ms(uptime, { long: true })})`);
  }
}

async function stopServer ({ port }) {
  await sendCommand({ port }, 'shutdown');
  console.log(`Server on port ${port} shut down`);
}

async function clearServer ({ port }) {
  await sendCommand({ port }, 'clear');
  console.log(`All databases cleared on port ${port}`);
}

async function sendCommand ({ port }, method, ...args) {
  if (!(await portActive(port))) {
    console.log(`No server active on port ${port}`);
    process.exit(1);
  }

  const client = new RpcClient({ port });
  return client.call(method, ...args)
}
