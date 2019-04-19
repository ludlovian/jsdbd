import RpcClient from 'jsrpc/client';
import { spawn } from 'child_process';
import { createConnection } from 'net';

let client;
class Datastore {
  constructor (options) {
    const { port, ping, ...otherOptions } = options;
    this.options = otherOptions;
    if (!client) client = new RpcClient({ port });
    const { filename } = this.options;
    for (const method of METHODS) {
      this[method] = client.call.bind(client, method, filename);
    }
    if (ping) setInterval(() => this.load(), ping).unref();
  }
  static async ensureServer (options) {
    const { port } = options;
    if (await serverActive(port)) return false
    launchServer(options);
    let ms = 10;
    while (ms < 2000) {
      await delay(ms);
      if (await serverActive(port)) return true
      ms *= 2;
    }
    throw new Error('Could not launch jsdbd')
  }
  static async connect (options) {
    await Datastore.ensureServer(options);
    const datastore = new Datastore(options);
    await datastore.load();
    return datastore
  }
  async load () {
    const indexes = await client.call('connect', this.options);
    this.indexes = {};
    for (const ix of indexes) {
      this.indexes[ix.fieldName] = new Index(ix, this);
    }
  }
  async ensureIndex (options) {
    const res = await client.call('ensureIndex', this.options.filename, options);
    await this.load();
    return res
  }
  async deleteIndex (fieldName) {
    const res = await client.call(
      'deleteIndex',
      this.options.filename,
      fieldName
    );
    await this.load();
    return res
  }
}
class Index {
  constructor (options, datastore) {
    this.options = options;
    const name = options.fieldName;
    const filename = datastore.options.filename;
    this.getAll = client.call.bind(client, 'indexGetAll', filename, name);
    this.find = client.call.bind(client, 'indexFind', filename, name);
    this.findOne = client.call.bind(client, 'indexFindOne', filename, name);
  }
}
const METHODS = [
  'connect',
  'getAll',
  'insert',
  'update',
  'delete',
  'compact',
  'setAutoCompaction',
  'stopAutoCompaction'
];
function serverActive (port) {
  return new Promise((resolve, reject) => {
    let tm = setTimeout(
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
function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
function launchServer (options) {
  const { port, idleTimeout, command = 'jsdbd' } = options;
  let cmd = `${command} --port ${port}`;
  if (idleTimeout) cmd += ` --timeout ${idleTimeout}`;
  spawn(cmd, [], { detached: true, shell: true });
}

export default Datastore;
