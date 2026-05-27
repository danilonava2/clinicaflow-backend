require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Archivo para guardar el estado Pro de los usuarios
const PRO_STATUS_FILE = './pro-status.json';

// Leer estado Pro guardado
function loadProStatus() {
  try {
    if (fs.existsSync(PRO_STATUS_FILE)) {
      const data = fs.readFileSync(PRO_STATUS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error al cargar estado Pro:', error);
  }
  return {};
}

// Guardar estado Pro
function saveProStatus(status) {
  try {
    fs.writeFileSync(PRO_STATUS_FILE, JSON.stringify(status, null, 2));
  } catch (error) {
    console.error('Error al guardar estado Pro:', error);
  }
}

let proStatus = loadProStatus();

// Configurar Mercado Pago
mercadopago.configure({
  access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'ClinicaFlow Backend funcionando' });
});

app.get('/api/health', (req, res) => {
  res.status(200).send('OK');
});

// Endpoint para crear suscripción
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { planType, payerEmail, userId } = req.body;
    
    const planConfig = {
      monthly: { amount: 9990, frequency: 1, title: 'ClinicaFlow Pro - Mensual', days: 30 },
      yearly: { amount: 99900, frequency: 12, title: 'ClinicaFlow Pro - Anual', days: 365 }
    };
    
    const plan = planConfig[planType];
    if (!plan) {
      return res.status(400).json({ error: 'Plan no válido' });
    }
    
    const subscription = {
      reason: plan.title,
      external_reference: userId,
      payer_email: payerEmail,
      site_id: 'MLC',
      auto_recurring: {
        frequency: plan.frequency,
        frequency_type: 'months',
        transaction_amount: plan.amount,
        currency_id: 'CLP'
      },
      back_url: 'https://tu-app.com/success',
      status: 'pending'
    };
    
    const response = await mercadopago.preapproval.create(subscription);
    
    // Guardar estado pendiente
    proStatus[userId] = {
      status: 'pending',
      plan: planType,
      email: payerEmail,
      createdAt: new Date().toISOString()
    };
    saveProStatus(proStatus);
    
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

// Endpoint para verificar estado Pro (con expiración automática)
app.get('/api/check-pro', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId requerido' });
  }
  
  const userPro = proStatus[userId];
  
  if (!userPro) {
    return res.json({ isPro: false });
  }
  
  if (userPro.status !== 'active') {
    return res.json({ isPro: false });
  }
  
  // Verificar si expiró
  const expirationDate = new Date(userPro.expirationDate);
  const now = new Date();
  
  if (now > expirationDate) {
    userPro.status = 'expired';
    saveProStatus(proStatus);
    console.log(`Usuario ${userId} suscripción expirada`);
    return res.json({ isPro: false, expired: true });
  }
  
  // Calcular días restantes
  const daysLeft = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
  
  res.json({ 
    isPro: true,
    expirationDate: userPro.expirationDate,
    daysLeft: daysLeft,
    plan: userPro.plan
  });
});

// Endpoint para obtener detalles completos de la suscripción
app.get('/api/pro-details', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId requerido' });
  }
  
  const userPro = proStatus[userId];
  if (!userPro || userPro.status !== 'active') {
    return res.json({ active: false });
  }
  
  const expirationDate = new Date(userPro.expirationDate);
  const now = new Date();
  const daysLeft = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
  
  res.json({
    active: true,
    expirationDate: userPro.expirationDate,
    daysLeft: daysLeft,
    plan: userPro.plan,
    email: userPro.email
  });
});

// Webhook para confirmar pagos
app.post('/api/webhook', (req, res) => {
  console.log('Webhook recibido:', req.body);
  
  try {
    const { data, type } = req.body;
    if (type === 'subscription_preapproval') {
      const userId = data.external_reference;
      
      if (userId && proStatus[userId]) {
        // Calcular días según el plan
        const planDays = proStatus[userId].plan === 'monthly' ? 30 : 365;
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + planDays);
        
        proStatus[userId].status = 'active';
        proStatus[userId].expirationDate = expirationDate.toISOString();
        proStatus[userId].updatedAt = new Date().toISOString();
        saveProStatus(proStatus);
        console.log(`Usuario ${userId} activado como Pro hasta ${expirationDate.toISOString()}`);
      }
    }
  } catch (error) {
    console.error('Error en webhook:', error);
  }
  
  res.status(200).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});
