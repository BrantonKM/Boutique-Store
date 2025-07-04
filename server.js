// server.js - M-Pesa Backend Server for Curvy Elegance
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (your frontend)
app.use(express.static('public'));

// M-Pesa Configuration
const MPESA_CONFIG = {
    consumer_key: process.env.MPESA_CONSUMER_KEY,
    consumer_secret: process.env.MPESA_CONSUMER_SECRET,
    business_short_code: process.env.MPESA_BUSINESS_SHORT_CODE,
    passkey: process.env.MPESA_PASSKEY,
    callback_url: process.env.MPESA_CALLBACK_URL || 'https://yourdomain.com/api/mpesa/callback',
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox' // 'sandbox' or 'production'
};

// M-Pesa URLs
const MPESA_URLS = {
    sandbox: {
        oauth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        stkpush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        stkquery: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query'
    },
    production: {
        oauth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        stkpush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        stkquery: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
    }
};

// In-memory storage for transactions (use a database in production)
const transactions = new Map();

// Utility function to generate timestamp
function generateTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hour}${minute}${second}`;
}

// Utility function to generate password
function generatePassword(businessShortCode, passkey, timestamp) {
    const data = businessShortCode + passkey + timestamp;
    return Buffer.from(data).toString('base64');
}

// Get M-Pesa access token
async function getAccessToken() {
    try {
        const url = MPESA_URLS[MPESA_CONFIG.environment].oauth;
        const credentials = Buffer.from(`${MPESA_CONFIG.consumer_key}:${MPESA_CONFIG.consumer_secret}`).toString('base64');
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        throw new Error('Failed to get M-Pesa access token');
    }
}

// Initiate STK Push
async function initiateSTKPush(phoneNumber, amount, accountReference, transactionDesc) {
    try {
        const accessToken = await getAccessToken();
        const timestamp = generateTimestamp();
        const password = generatePassword(MPESA_CONFIG.business_short_code, MPESA_CONFIG.passkey, timestamp);
        
        const requestBody = {
            BusinessShortCode: MPESA_CONFIG.business_short_code,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: phoneNumber,
            PartyB: MPESA_CONFIG.business_short_code,
            PhoneNumber: phoneNumber,
            CallBackURL: MPESA_CONFIG.callback_url,
            AccountReference: accountReference,
            TransactionDesc: transactionDesc
        };
        
        const response = await axios.post(
            MPESA_URLS[MPESA_CONFIG.environment].stkpush,
            requestBody,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error('STK Push error:', error.response?.data || error.message);
        throw new Error('STK Push failed');
    }
}

// Query STK Push transaction status
async function querySTKPushStatus(checkoutRequestID) {
    try {
        const accessToken = await getAccessToken();
        const timestamp = generateTimestamp();
        const password = generatePassword(MPESA_CONFIG.business_short_code, MPESA_CONFIG.passkey, timestamp);
        
        const requestBody = {
            BusinessShortCode: MPESA_CONFIG.business_short_code,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestID
        };
        
        const response = await axios.post(
            MPESA_URLS[MPESA_CONFIG.environment].stkquery,
            requestBody,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error('STK Query error:', error.response?.data || error.message);
        throw new Error('STK Query failed');
    }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: MPESA_CONFIG.environment 
    });
});

// Initiate M-Pesa payment
app.post('/api/mpesa/stkpush', async (req, res) => {
    try {
        const { phoneNumber, amount, description } = req.body;
        
        // Validate input
        if (!phoneNumber || !amount || !description) {
            return res.status(400).json({
                success: false,
                message: 'Phone number, amount, and description are required'
            });
        }
        
        // Validate phone number format (Kenyan format)
        if (!phoneNumber.match(/^254[0-9]{9}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format. Use 254XXXXXXXXX'
            });
        }
        
        // Validate amount (minimum 1 KSh)
        if (amount < 1) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be at least 1 KSh'
            });
        }
        
        // Generate unique transaction reference
        const transactionRef = `CE${Date.now()}`;
        
        // Initiate STK Push
        const stkResponse = await initiateSTKPush(
            phoneNumber,
            amount,
            transactionRef,
            description
        );
        
        // Store transaction details
        const transaction = {
            id: transactionRef,
            phoneNumber,
            amount,
            description,
            checkoutRequestID: stkResponse.CheckoutRequestID,
            merchantRequestID: stkResponse.MerchantRequestID,
            status: 'PENDING',
            timestamp: new Date().toISOString(),
            responseCode: stkResponse.ResponseCode,
            responseDescription: stkResponse.ResponseDescription
        };
        
        transactions.set(transactionRef, transaction);
        
        // Log transaction
        console.log('STK Push initiated:', {
            transactionRef,
            phoneNumber,
            amount,
            checkoutRequestID: stkResponse.CheckoutRequestID
        });
        
        res.json({
            success: true,
            message: 'STK Push initiated successfully',
            transactionId: transactionRef,
            checkoutRequestID: stkResponse.CheckoutRequestID,
            merchantRequestID: stkResponse.MerchantRequestID,
            responseCode: stkResponse.ResponseCode,
            responseDescription: stkResponse.ResponseDescription
        });
        
    } catch (error) {
        console.error('STK Push error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
});

// M-Pesa callback endpoint
app.post('/api/mpesa/callback', (req, res) => {
    console.log('M-Pesa callback received:', JSON.stringify(req.body, null, 2));
    
    try {
        const { Body } = req.body;
        
        if (!Body || !Body.stkCallback) {
            return res.status(400).json({ success: false, message: 'Invalid callback data' });
        }
        
        const { stkCallback } = Body;
        const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;
        
        // Find transaction by CheckoutRequestID
        let transaction = null;
        for (const [key, value] of transactions) {
            if (value.checkoutRequestID === CheckoutRequestID) {
                transaction = value;
                break;
            }
        }
        
        if (!transaction) {
            console.error('Transaction not found for CheckoutRequestID:', CheckoutRequestID);
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        // Update transaction status
        transaction.resultCode = ResultCode;
        transaction.resultDescription = ResultDesc;
        transaction.callbackTimestamp = new Date().toISOString();
        
        if (ResultCode === 0) {
            // Payment successful
            transaction.status = 'COMPLETED';
            
            // Extract payment details from callback
            if (stkCallback.CallbackMetadata && stkCallback.CallbackMetadata.Item) {
                const metadata = {};
                stkCallback.CallbackMetadata.Item.forEach(item => {
                    metadata[item.Name] = item.Value;
                });
                
                transaction.mpesaReceiptNumber = metadata.MpesaReceiptNumber;
                transaction.transactionDate = metadata.TransactionDate;
                transaction.phoneNumber = metadata.PhoneNumber;
                transaction.amount = metadata.Amount;
            }
            
            console.log('Payment completed successfully:', {
                transactionId: transaction.id,
                mpesaReceiptNumber: transaction.mpesaReceiptNumber,
                amount: transaction.amount
            });
            
            // Here you would typically:
            // 1. Update order status in database
            // 2. Send confirmation email/SMS
            // 3. Update inventory
            // 4. Generate invoice
            
        } else {
            // Payment failed
            transaction.status = 'FAILED';
            console.log('Payment failed:', {
                transactionId: transaction.id,
                resultCode: ResultCode,
                resultDescription: ResultDesc
            });
        }
        
        // Update transaction in storage
        transactions.set(transaction.id, transaction);
        
        // Save transaction to file for persistence (use database in production)
        saveTransactionToFile(transaction);
        
        res.json({ success: true, message: 'Callback processed successfully' });
        
    } catch (error) {
        console.error('Callback processing error:', error.message);
        res.status(500).json({ success: false, message: 'Callback processing failed' });
    }
});

// Query transaction status
app.get('/api/mpesa/status/:transactionId', async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        const transaction = transactions.get(transactionId);
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        // If transaction is still pending, query M-Pesa for latest status
        if (transaction.status === 'PENDING') {
            try {
                const queryResponse = await querySTKPushStatus(transaction.checkoutRequestID);
                
                if (queryResponse.ResultCode === '0') {
                    transaction.status = 'COMPLETED';
                    transaction.resultCode = queryResponse.ResultCode;
                    transaction.resultDescription = queryResponse.ResultDesc;
                    transactions.set(transactionId, transaction);
                } else if (queryResponse.ResultCode !== '1037') { // 1037 = Request in progress
                    transaction.status = 'FAILED';
                    transaction.resultCode = queryResponse.ResultCode;
                    transaction.resultDescription = queryResponse.ResultDesc;
                    transactions.set(transactionId, transaction);
                }
            } catch (queryError) {
                console.error('Query error:', queryError.message);
                // Keep original status if query fails
            }
        }
        
        res.json({
            success: true,
            transaction: {
                id: transaction.id,
                status: transaction.status,
                amount: transaction.amount,
                phoneNumber: transaction.phoneNumber,
                description: transaction.description,
                timestamp: transaction.timestamp,
                mpesaReceiptNumber: transaction.mpesaReceiptNumber,
                resultDescription: transaction.resultDescription
            }
        });
        
    } catch (error) {
        console.error('Status query error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get transaction status'
        });
    }
});

// Get all transactions (admin endpoint)
app.get('/api/mpesa/transactions', (req, res) => {
    try {
        const allTransactions = Array.from(transactions.values()).map(t => ({
            id: t.id,
            status: t.status,
            amount: t.amount,
            phoneNumber: t.phoneNumber,
            description: t.description,
            timestamp: t.timestamp,
            mpesaReceiptNumber: t.mpesaReceiptNumber,
            resultDescription: t.resultDescription
        }));
        
        res.json({
            success: true,
            transactions: allTransactions,
            total: allTransactions.length
        });
    } catch (error) {
        console.error('Get transactions error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get transactions'
        });
    }
});

// Utility function to save transaction to file
function saveTransactionToFile(transaction) {
    try {
        const transactionsDir = path.join(__dirname, 'transactions');
        if (!fs.existsSync(transactionsDir)) {
            fs.mkdirSync(transactionsDir, { recursive: true });
        }
        
        const filename = `${transaction.id}.json`;
        const filepath = path.join(transactionsDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(transaction, null, 2));
        console.log(`Transaction saved to file: ${filepath}`);
    } catch (error) {
        console.error('Error saving transaction to file:', error.message);
    }
}

// Load transactions from files on startup
function loadTransactionsFromFiles() {
    try {
        const transactionsDir = path.join(__dirname, 'transactions');
        if (fs.existsSync(transactionsDir)) {
            const files = fs.readdirSync(transactionsDir);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const filepath = path.join(transactionsDir, file);
                    const transactionData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
                    transactions.set(transactionData.id, transactionData);
                }
            });
            console.log(`Loaded ${transactions.size} transactions from files`);
        }
    } catch (error) {
        console.error('Error loading transactions from files:', error.message);
    }
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Curvy Elegance M-Pesa Server running on port ${PORT}`);
    console.log(`📱 Environment: ${MPESA_CONFIG.environment}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    
    // Load existing transactions
    loadTransactionsFromFiles();
    
    // Log configuration (without sensitive data)
    console.log('📋 Configuration:');
    console.log(`   - Business Short Code: ${MPESA_CONFIG.business_short_code}`);
    console.log(`   - Callback URL: ${MPESA_CONFIG.callback_url}`);
    console.log(`   - Consumer Key: ${MPESA_CONFIG.consumer_key ? 'Set' : 'Not set'}`);
    console.log(`   - Consumer Secret: ${MPESA_CONFIG.consumer_secret ? 'Set' : 'Not set'}`);
    console.log(`   - Passkey: ${MPESA_CONFIG.passkey ? 'Set' : 'Not set'}`);
});