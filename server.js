require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Archivo para guardar el estado Pro
const PRO_STATUS_FILE = './pro-status.json';

function loadProStatus() {
  try {
    if (fs.existsSync(PRO_STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(PRO_STATUS_FILE, 'utf8'));
    }
  } catch (error) {}
  return {};
}

function saveProStatus(status) {
  fs.writeFileSync(PRO_STATUS_FILE, JSON.stringify(status, null, 2));
}

let proStatus = loadProStatus();

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'ClinicaFlow Backend funcionando' });
});

// ==================== WEBHOOK DE MERCADO PAGO ====================
app.post('/api/webhook', (req, res) => {
  console.log('🔔 Webhook recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data } = req.body;
    
    // Verificar que es una notificación de suscripción
    if (type === 'subscription_preapproval') {
      const subscriptionId = data.id;
      const externalReference = data.external_reference;
      const payerEmail = data.payer_email;
      const status = data.status;
      
      console.log(`📝 Suscripción: ID=${subscriptionId}, Usuario=${externalReference}, Email=${payerEmail}, Estado=${status}`);
      
      // Si el pago fue aprobado, activar Pro
      if (status === 'authorized' || status === 'active') {
        // Determinar plan según el monto (si se puede) o por defecto mensual
        // Por simplicidad, usamos el external_reference como userId
        if (externalReference) {
          // Calcular días según el plan (30 o 365)
          // Por defecto 30, se puede mejorar detectando el monto
          const days = 30; // Mensual por defecto
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + days);
          
          proStatus[externalReference] = {
            status: 'active',
            plan: 'monthly',
            expirationDate: expirationDate.toISOString(),
            activatedAt: new Date().toISOString(),
            subscriptionId: subscriptionId,
            email: payerEmail
          };
          saveProStatus(proStatus);
          
          console.log(`✅ Usuario ${externalReference} activado como Pro hasta ${expirationDate.toISOString()}`);
        }
      }
      
      res.status(200).send('OK');
    } else {
      res.status(200).send('OK');
    }
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).send('Error');
  }
});

// ==================== ENDPOINTS PARA LA APP ====================

// Crear solicitud de pago (devuelve el link)
app.post('/api/create-payment', (req, res) => {
  const { planType, userId } = req.body;
  
  const planConfig = {
    monthly: {
      url: 'https://www.mercadopago.cl/subscriptions/checkout?preapproval_plan_id=409443b4d5c948b7af3913267bf78dce',
      days: 30,
      price: 2500
    },
    yearly: {
      url: 'https://www.mercadopago.cl/subscriptions/checkout?preapproval_plan_id=80e5fcdffc6f41b1b5f773b19e21e3b6',
      days: 365,
      price: 20000
    }
  };
  
  const plan = planConfig[planType];
  if (!plan) {
    return res.status(400).json({ error: 'Plan no válido' });
  }
  
  // Guardar solicitud pendiente para asociar el userId con el pago
  const pendingPayments = JSON.parse(fs.readFileSync('./pending-payments.json', 'utf8') || '{}');
  pendingPayments[userId] = {
    plan: planType,
    days: plan.days,
    createdAt: Date.now()
  };
  fs.writeFileSync('./pending-payments.json', JSON.stringify(pendingPayments, null, 2));
  
  res.json({ 
    success: true, 
    url: plan.url,
    message: 'Serás redirigido a Mercado Pago para completar el pago.'
  });
});

// Verificar estado Pro
app.get('/api/check-pro', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId requerido' });
  }
  
  const userPro = proStatus[userId];
  if (!userPro || userPro.status !== 'active') {
    return res.json({ isPro: false });
  }
  
  // Verificar expiración
  const expirationDate = new Date(userPro.expirationDate);
  if (new Date() > expirationDate) {
    userPro.status = 'expired';
    saveProStatus(proStatus);
    return res.json({ isPro: false, expired: true });
  }
  
  const daysLeft = Math.ceil((expirationDate - new Date()) / (1000 * 60 * 60 * 24));
  res.json({ 
    isPro: true, 
    daysLeft: daysLeft,
    expirationDate: userPro.expirationDate
  });
});

// Endpoint para activar manualmente con código (opcional, por si falla webhook)
app.post('/api/activate-manual', (req, res) => {
  const { userId, planType } = req.body;
  const days = planType === 'monthly' ? 30 : 365;
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + days);
  
  proStatus[userId] = {
    status: 'active',
    plan: planType,
    expirationDate: expirationDate.toISOString(),
    activatedAt: new Date().toISOString(),
    manual: true
  };
  saveProStatus(proStatus);
  
  res.json({ success: true, expirationDate: expirationDate.toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});
