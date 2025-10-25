const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const initDB = require('./db'); // uses your existing db.js

const app = express();
app.use(bodyParser.json());

const PORT = 3000;
const HOST = '0.0.0.0';
const SECRET_KEY = process.env.CARDZEN_JWT_SECRET || 'Geraldamanda412';

let db;

// JWT middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Token required' });

  jwt.verify(token, SECRET_KEY, (err, payload) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = payload; // { id, username, email }
    next();
  });
}

// Initialize DB and start server
initDB().then(database => {
  db = database;

  // Root
  app.get('/', (req, res) => res.send('CARDZEN API is running!'));

  // Register
  app.post('/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    try {
      const checkStmt = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?');
      checkStmt.bind([username, email]);
      const exists = checkStmt.step();
      checkStmt.free();
      if (exists) return res.status(400).json({ message: 'Username or email already exists' });

      const password_hash = bcrypt.hashSync(password, 8);
      const insertStmt = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
      insertStmt.run([username, email, password_hash]);
      insertStmt.free();

      fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));
      return res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Login (returns JWT)
  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username and password required' });

    try {
      const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
      stmt.bind([username]);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();

      if (!row || !bcrypt.compareSync(password, row.password_hash)) {
        return res.status(400).json({ message: 'Invalid username or password' });
      }

      const payload = { id: row.id, username: row.username, email: row.email };
      const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '1h' });

      const user = { id: row.id, username: row.username, email: row.email };
      return res.json({ message: 'Login successful', token, user });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Create card (JWT required)
  app.post('/cards', authenticateToken, (req, res) => {
    const { name, description, price } = req.body;
    if (!name || !description || price === undefined) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    try {
      const insert = db.prepare('INSERT INTO cards (user_id, name, description, price) VALUES (?, ?, ?, ?)');
      insert.run([req.user.id, name, description, price]);
      insert.free();
      fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));
      return res.status(201).json({ message: 'Card created successfully' });
    } catch (err) {
      console.error('Create card error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // List all cards
  app.get('/cards', (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM cards');
      const cards = [];
      while (stmt.step()) cards.push(stmt.getAsObject());
      stmt.free();
      return res.json(cards);
    } catch (err) {
      console.error('List cards error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Get single card
  app.get('/cards/:id', (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM cards WHERE id = ?');
      stmt.bind([req.params.id]);
      const card = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      if (!card) return res.status(404).json({ message: 'Card not found' });
      return res.json(card);
    } catch (err) {
      console.error('Get card error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Update card (owner only)
  app.put('/cards/:id', authenticateToken, (req, res) => {
    const { name, description, price } = req.body;
    try {
      const select = db.prepare('SELECT * FROM cards WHERE id = ?');
      select.bind([req.params.id]);
      const card = select.step() ? select.getAsObject() : null;
      select.free();
      if (!card) return res.status(404).json({ message: 'Card not found' });
      if (card.user_id !== req.user.id) return res.status(403).json({ message: 'Not allowed' });

      const update = db.prepare('UPDATE cards SET name = ?, description = ?, price = ? WHERE id = ?');
      update.run([name || card.name, description || card.description, price !== undefined ? price : card.price, req.params.id]);
      update.free();
      fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));
      return res.json({ message: 'Card updated successfully' });
    } catch (err) {
      console.error('Update card error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Delete card (owner only)
  app.delete('/cards/:id', authenticateToken, (req, res) => {
    try {
      const select = db.prepare('SELECT * FROM cards WHERE id = ?');
      select.bind([req.params.id]);
      const card = select.step() ? select.getAsObject() : null;
      select.free();
      if (!card) return res.status(404).json({ message: 'Card not found' });
      if (card.user_id !== req.user.id) return res.status(403).json({ message: 'Not allowed' });

      const del = db.prepare('DELETE FROM cards WHERE id = ?');
      del.run([req.params.id]);
      del.free();
      fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));
      return res.json({ message: 'Card deleted successfully' });
    } catch (err) {
      console.error('Delete card error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Buy card / create transaction
  app.post('/buy/:cardId', authenticateToken, (req, res) => {
    const cardId = parseInt(req.params.cardId, 10);
    try {
      const select = db.prepare('SELECT * FROM cards WHERE id = ?');
      select.bind([cardId]);
      const card = select.step() ? select.getAsObject() : null;
      select.free();
      if (!card) return res.status(404).json({ message: 'Card not found' });

      const insert = db.prepare('INSERT INTO transactions (buyer_id, card_id, amount) VALUES (?, ?, ?)');
      insert.run([req.user.id, card.id, card.price]);
      insert.free();
      fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));
      return res.status(201).json({ message: 'Purchase successful', card });
    } catch (err) {
      console.error('Buy error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // List user's transactions
  app.get('/transactions', authenticateToken, (req, res) => {
    try {
      const stmt = db.prepare('SELECT t.id, c.name, c.price, t.created_at FROM transactions t JOIN cards c ON t.card_id = c.id WHERE t.buyer_id = ?');
      stmt.bind([req.user.id]);
      const transactions = [];
      while (stmt.step()) transactions.push(stmt.getAsObject());
      stmt.free();
      return res.json(transactions);
    } catch (err) {
      console.error('List transactions error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Start server
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
