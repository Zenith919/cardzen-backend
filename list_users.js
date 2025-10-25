const initDB = require('./db');

initDB().then(db => {
  try {
    const stmt = db.prepare('SELECT id, username, email FROM users');
    while (stmt.step()) {
      console.log(stmt.getAsObject());
    }
    stmt.free();
  } catch (e) {
    console.error('DB read error', e);
  }
  process.exit(0);
}).catch(err => {
  console.error('initDB failed', err);
});
