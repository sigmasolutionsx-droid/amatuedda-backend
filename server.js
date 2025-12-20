const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
app.locals.supabase = supabase;

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'AmatuEdda',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/bonuses', require('./routes/bonuses'));

// Error handling
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ success: false, error: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 AmatuEdda running on port ${PORT}`);
  console.log(`✅ Database: ${process.env.SUPABASE_URL ? 'Connected' : 'Not configured'}`);
  console.log(`✅ Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Configured' : 'Not configured'}\n`);
});
