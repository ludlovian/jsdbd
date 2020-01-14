import { RpcClient } from 'jsrpc';
import 'net';

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

let client;
const staticMethods = ['status', 'housekeep', 'clear', 'shutdown'];
class Database {
  constructor (opts) {
    if (typeof opts === 'string') opts = { filename: opts };
    const { port = 39720, ...options } = opts;
    this.options = options;
    if (!client) {
      client = new RpcClient({ port });
      for (const method of staticMethods) {
        Database[method] = client.call.bind(client, method);
      }
    }
    const { filename } = this.options;
    for (const method of jsdbMethods.values()) {
      this[method] = client.call.bind(client, 'dispatch', filename, method);
    }
  }
}

export default Database;
