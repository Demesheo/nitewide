import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import routes from './routes/index.js';
import { sequelize } from './models/index.js'; // ✅ Named import

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// API routes
app.use('/api', routes);

// Test route
app.get('/', (req, res) => res.send('Nitewide API Running 🚀'));

// Sync DB and start server
sequelize.sync({ alter: true }) // alter:true for dev; use migrations in prod
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => console.error('DB sync error:', err));
