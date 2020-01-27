# jsdbd
Daemon version of `jsdb`

## Client API

`import Datastore from 'jsdbd'`

Is compatible with `jsdb` except the following changes

To ensure the daemon is running, exec `jsdbd start --silent`.


### Database

`const db = new Database(opts)`

Creates a connection to a remote db daemon.

Options:
- `port` - the port of the server
- `filename` - the name (relative to `files`) of the db file

### status

`const s = await Database.status()`

returns an object with the following:
- `uptime` - uptime in ms
- `idleTime` - idle/housekeep time in ms
- `files` - where the db files are
- `databases` - array of `{ name, uptime }` for each open database

### housekeep

`await Database.housekeep()`

Performs housekeeping

### clear

`await Database.clear()`

Closes all open databases (forced housekeeping)

### shutdown

`await Database.shutdown()`

Requests the daemon to shutdown


## Server API

run `jsdbd --help` for details, but options include:

Commands include:
- `status` - show the status of the server
- `start` - start the server
- `stop` - stop the server
- `clear` - close any open databases. Will be re-opened on next use though.

Options include:
- `-f|--files` - where the db files can be found
- `-s|--silent` - be quiet
- `-p|--port` - port to use
- `--idleTime` - cleaning/closing interval
