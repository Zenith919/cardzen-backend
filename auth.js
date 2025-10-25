const jwt = require('jsonwebtoken');
const SECRET_KEY = 'your_secret_key_here'; // replace with a strong key

// Middleware to protect routes
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.status(401).json({ message: 'Token required' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user; // { id, username }
        next();
    });
}

// Register
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ message: 'All fields required' });

    const checkStmt = db.prepare('SELECT id FROM users WHERE username=? OR email=?');
    checkStmt.bind([username, email]);
    const exists = checkStmt.step();
    checkStmt.free();

    if (exists) return res.status(400).json({ message: 'Username/email exists' });

    const password_hash = bcrypt.hashSync(password, 8);
    const insertStmt = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
    insertStmt.run([username, email, password_hash]);
    insertStmt.free();
    fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));

    res.status(201).json({ message: 'User registered successfully' });
});

// Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const stmt = db.prepare('SELECT * FROM users WHERE username=?');
    stmt.bind([username]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();

    if (!row || !bcrypt.compareSync(password, row.password_hash))
        return res.status(400).json({ message: 'Invalid username or password' });

    const token = jwt.sign({ id: row.id, username: row.username }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ message: 'Login successful', token, user: { id: row.id, username: row.username, email: row.email } });
});

// Create a card (JWT required)
app.post('/cards', authenticateToken, (req, res) => {
    const { name, description, price } = req.body;
    if (!name || !description || !price)
        return res.status(400).json({ message: 'All fields required' });

    const stmt = db.prepare('INSERT INTO cards (user_id, name, description, price) VALUES (?, ?, ?, ?)');
    stmt.run([req.user.id, name, description, price]);
    stmt.free();
    fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));

    res.status(201).json({ message: 'Card created successfully' });
});

// List all cards
app.get('/cards', (req, res) => {
    const stmt = db.prepare('SELECT * FROM cards');
    const cards = [];
    while (stmt.step()) {
        cards.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(cards);
});

// Get single card
app.get('/cards/:id', (req, res) => {
    const stmt = db.prepare('SELECT * FROM cards WHERE id=?');
    stmt.bind([req.params.id]);
    const card = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    if (!card) return res.status(404).json({ message: 'Card not found' });
    res.json(card);
});

// Update card (owner only)
app.put('/cards/:id', authenticateToken, (req, res) => {
    const { name, description, price } = req.body;

    // check ownership
    const stmt = db.prepare('SELECT * FROM cards WHERE id=?');
    stmt.bind([req.params.id]);
    const card = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    if (!card) return res.status(404).json({ message: 'Card not found' });
    if (card.user_id !== req.user.id) return res.status(403).json({ message: 'Not allowed' });

    const updateStmt = db.prepare('UPDATE cards SET name=?, description=?, price=? WHERE id=?');
    updateStmt.run([name || card.name, description || card.description, price || card.price, req.params.id]);
    updateStmt.free();
    fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));

    res.json({ message: 'Card updated successfully' });
});

// Delete card (owner only)
app.delete('/cards/:id', authenticateToken, (req, res) => {
    const stmt = db.prepare('SELECT * FROM cards WHERE id=?');
    stmt.bind([req.params.id]);
    const card = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    if (!card) return res.status(404).json({ message: 'Card not found' });
    if (card.user_id !== req.user.id) return res.status(403).json({ message: 'Not allowed' });

    const delStmt = db.prepare('DELETE FROM cards WHERE id=?');
    delStmt.run([req.params.id]);
    delStmt.free();
    fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));

    res.json({ message: 'Card deleted successfully' });
});

// Buy a card
app.post('/buy/:cardId', authenticateToken, (req, res) => {
    const cardId = req.params.cardId;

    const stmt = db.prepare('SELECT * FROM cards WHERE id=?');
    stmt.bind([cardId]);
    const card = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    if (!card) return res.status(404).json({ message: 'Card not found' });

    const buyStmt = db.prepare('INSERT INTO transactions (buyer_id, card_id, amount) VALUES (?, ?, ?)');
    buyStmt.run([req.user.id, card.id, card.price]);
    buyStmt.free();
    fs.writeFileSync('./cardzen.db', Buffer.from(db.export()));

    res.json({ message: 'Purchase successful', card });
});

// List user's transactions
app.get('/transactions', authenticateToken, (req, res) => {
    const stmt = db.prepare('SELECT t.id, c.name, c.price, t.created_at FROM transactions t JOIN cards c ON t.card_id=c.id WHERE t.buyer_id=?');
    stmt.bind([req.user.id]);
    const transactions = [];
    while (stmt.step()) transactions.push(stmt.getAsObject());
    stmt.free();
    res.json(transactions);
});


