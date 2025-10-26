// Minimal Node.js Express server for Termux

const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

// Parse JSON requests
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.send('Hello from Termux Node.js server!');
});

// Example API route
app.post('/api/test', (req, res) => {
  const data = req.body;
  res.json({ message: 'Received your data', data });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${port}`);
});
