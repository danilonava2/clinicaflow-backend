require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');
const admin = require('firebase-admin');

// Inicializar Firebase con variables de entorno
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// Configurar Mercado Pago
mercadopago.configure({
  access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// Endpoint para crear suscripción
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { planType, payerEmail, userId } = req.body;
    
    const planConfig = {
      monthly: { amount: 9990, frequency: 1, title: 'ClinicaFlow Pro - Mensual' },
      yearly: { amount: 99900, frequency: 12, title: 'ClinicaFlow Pro - Anual' }
    };
    
    const plan = planConfig[planType];
    if (!plan) {
      return res.status(400).json({ error: 'Plan no válido' });
    }
    
    const subscription = {
      reason: plan.title,
      external_reference: userId,
      payer_email: payerEmail,
      auto_recurring: {
        frequency: plan.frequency,
        frequency_type: 'months',
        transaction_amount: plan.amount,
        currency_id: 'CLP'
      },
      back_url: process.env.BACK_URL || 'https://tu-app.com/success',
      status: 'pending'
    };
    
    const response = await mercadopago.preapproval.create(subscription);
    
    await db.collection('subscriptions').doc(userId).set({
      userId: userId,
      plan: planType,
      status: 'pending',
      email: payerEmail,
      createdAt: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      initPoint: response.body.init_point,
      subscriptionId: response.body.id 
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para verificar estado Pro
app.get('/api/check-pro', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId requerido' });
  }
  
  try {
    const doc = await db.collection('subscriptions').doc(userId).get();
    const isPro = doc.exists && doc.data().status === 'active';
    res.json({ isPro });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook
app.post('/api/webhook', async (req, res) => {
  console.log('Webhook recibido:', req.body);
  
  try {
    const { data, type } = req.body;
    if (type === 'subscription_preapproval') {
      const subscriptionId = data.id;
      const userId = data.external_reference;
      
      await db.collection('subscriptions').doc(userId).update({
        status: 'active',
        subscriptionId: subscriptionId,
        updatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error en webhook:', error);
  }
  
  res.status(200).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
