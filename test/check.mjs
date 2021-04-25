import { test } from 'uvu'
import * as assert from 'uvu/assert'

import Database from '../src/client.mjs'

test('check server', async () => {
  Database._reset()

  const db = new Database({ port: 39798 })

  db.check().then(assert.unreachable, err =>
    assert.instance(err, Database.NoServer)
  )
})

test.run()
