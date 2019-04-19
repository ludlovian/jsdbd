# jsdbd
Daemon version of `jsdb`

## Client API

`import Datastore from 'jsdbd'`

Is compatible with `jsdb` except the following changes

### ensureServer

`await Datastore.ensureServer(options)`

Ensures the server end is running, starting if not.

Options include
- `port` - the port for the server (mandatory)
- `command` - the command to launch the server (default: `jsdbd`)
- `idleTimeout` - the idleTimeout for the server

### connect

`db = await Datastore.connect(options)`

Must be awaited. Calls `ensureServer` as well, so `port` must be specified.

In addition to the `jsdb` creation options (e.g. the mandatory `filename`), can also have
- `ping` - the frequency in ms of a regular heartbeat to keep the server alive

`autoload` is pointless. Databases are loaded as you connect to them. Ditto `load` is redundant

### stopAutoCompaction

this is now `await`-able

## Server API

`jsdbd -p|--port <port> -t|--timeout <timeout> -l|--log`
