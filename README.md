# Curvy Elegance M-Pesa Backend Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm 8+
- Safaricom Developer Account
- Public URL for callbacks (ngrok for local testing)

### 1. Installation

```bash
# Clone or create project directory
mkdir curvy-elegance-backend
cd curvy-elegance-backend

# Initialize npm and install dependencies
npm init -y
npm install express cors axios dotenv helmet morgan express-rate-limit express-validator jsonwebtoken bcryptjs uuid moment winston mongoose nodemailer multer compression

# Install dev dependencies
npm install --save-dev nodemon jest supertest eslint prettier @types/node
```

### 2. Environment Setup

Create a `.env` file in your project root:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# M-Pesa Safaricom Daraja API Configuration
MPESA_ENVIRONMENT=sandbox
MPESA_CONSUMER_KEY=your_consumer_key_here
MPESA_CONSUMER_SECRET=your_consumer_secret_here
MPESA_BUSINESS_SHORT_CODE=174379
MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
MPESA_CALLBACK_URL=https://your-ngrok-url.ngrok.io/api/mpesa/callback
```

### 3. Get M-Pesa Credentials

1. **Register at Safaricom Developer Portal**
   - Go to https://developer.safaricom.co.ke/
   - Create an account and verify your email
   - Create a new app

2. **Get Sandbox Credentials**
   - Consumer Key
   - Consumer Secret
   - Test Credentials (Business Short Code: 174379)
   - Passkey (provided in sandbox)

3. **For Production**
   - Apply for Go-Live approval
   - Get your Paybill/Till number
   - Get production credentials

### 4. Setup Public URL (For Local Testing)

```bash
# Install ngrok
npm install -g ngrok

# Start your server
npm run dev

# In another terminal, expose your local server
ngrok http 3000

# Copy the https URL (e.g., https://abc123.ngrok.io)
# Update MPESA_CALLBACK_URL in .env file
```

### 5. Project Structure

```
curvy-elegance-backend/
├── server.js                 # Main server file
├── package.json              # Dependencies
├── .env                      # Environment variables
├── .gitignore               # Git ignore file
├── README.md                # Documentation
├── public/                  # Static files (frontend)
│   ├── index.html
│   ├── styles.css
│   └── script.js
├── transactions/            # Transaction storage (auto-created)
├── logs/                    # Application logs
├── middleware/              # Custom middleware
├── routes/                  # API routes
├── models/                  # Database models
├── utils/                   # Utility functions
└── tests/                   # Test files
```

## 📡 API Endpoints

### 1. Health Check
```
GET /api/health
```

### 2. Initiate Payment
```
POST /api/mpesa/stkpush
Content-Type: application/json

{
  "phoneNumber": "254712345678",
  "amount": 1000,
  "description": "Purchase from Curvy Elegance"
}
```

### 3. Payment Callback (Safaricom calls this)
```
POST /api/mpesa/callback
```

### 4. Check Transaction Status
```
GET /api/mpesa/status/:transactionId
```

### 5. List All Transactions
```
GET /api/mpesa/transactions
```

## 🔧 Frontend Integration

Update your frontend JavaScript to use the backend:

```javascript
// Replace the mock M-Pesa function with this real implementation
async function initiateSTKPush(phoneNumber, amount, description) {
    try {
        const response = await fetch('http://localhost:3000/api/mpesa/stkpush', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                phoneNumber: phoneNumber,
                amount: amount,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            return {
                transactionId: data.transactionId,
                checkoutRequestID: data.checkoutRequestID,
                status: 'SUCCESS',
                message: data.message
            };
        } else {
            throw new Error(data.message || 'Payment failed');
        }
    } catch (error) {
        throw new Error(error.message || 'Network error. Please try again.');
    }
}

// Function to check payment status
async function checkPaymentStatus(transactionId) {
    try {
        const response = await fetch(`http://localhost:3000/api/mpesa/status/${transactionId}`);
        const data = await response.json();
        
        if (response.ok && data.success) {
            return data.transaction;
        } else {
            throw new Error(data.message || 'Failed to check status');
        }
    } catch (error) {
        throw new Error(error.message || 'Network error');
    }
}
```

## 🔒 Security Considerations

### 1. Environment Variables
- Never commit `.env` files to version control
- Use different credentials for development/production
- Rotate credentials regularly

### 2. Validation
- Validate all input parameters
- Check phone number format
- Validate amount ranges
- Sanitize callback data

### 3. Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
```

### 4. HTTPS
- Always use HTTPS in production
- Secure callback URLs
- Validate SSL certificates

## 🗄️ Database Integration

### MongoDB Example
```javascript
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
    checkoutRequestID: String,
    mpesaReceiptNumber: String,
    timestamp: { type: Date, default: Date.now },
    callbackTimestamp: Date
});

const Transaction = mongoose.model('Transaction', transactionSchema);
```