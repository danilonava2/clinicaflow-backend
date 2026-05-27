require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Archivo para guardar el estado Pro
const PRO_STATUS_FILE = './pro-status.json';
const PENDING_PAYMENTS_FILE = './pending-payments.json';

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

function loadPendingPayments() {
  try {
    if (fs.existsSync(PENDING_PAYMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(PENDING_PAYMENTS_FILE, 'utf8'));
    }
  } catch (error) {}
  return {};
}

function savePendingPayments(payments) {
  fs.writeFileSync(PENDING_PAYMENTS_FILE, JSON.stringify(payments, null, 2));
}

let proStatus = loadProStatus();

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'ClinicaFlow Backend funcionando' });
});

// ==================== ENDPOINTS ====================

// Crear solicitud de pago (devuelve el link)
app.post('/api/create-payment', (req, res) => {
  try {
    const { planType, userId } = req.body;
    
    console.log(`📝 Solicitud de pago recibida: plan=${planType}, userId=${userId}`);
    
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
    
    // Guardar solicitud pendiente
    const pendingPayments = loadPendingPayments();
    pendingPayments[userId] = {
      plan: planType,
      days: plan.days,
      createdAt: Date.now(),
      url: plan.url
    };
    savePendingPayments(pendingPayments);
    
    console.log(`✅ Enlace generado para usuario ${userId}`);
    
    res.json({ 
      success: true, 
      url: plan.url,
      message: 'Serás redirigido a Mercado Pago para completar el pago.'
    });
  } catch (error) {
    console.error('❌ Error en create-payment:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Verificar estado Pro
app.get('/api/check-pro', (req, res) => {
  try {
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
  } catch (error) {
    console.error('❌ Error en check-pro:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== WEBHOOK DE MERCADO PAGO ====================
app.post('/api/webhook', (req, res) => {
  console.log('🔔 Webhook recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data } = req.body;
    
    if (type === 'subscription_preapproval') {
      const externalReference = data.external_reference;
      const payerEmail = data.payer_email;
      const status = data.status;
      
      console.log(`📝 Suscripción: Usuario=${externalReference}, Email=${payerEmail}, Estado=${status}`);
      
      // Buscar si hay un pago pendiente para este usuario
      const pendingPayments = loadPendingPayments();
      const pendingData = externalReference && pendingPayments[externalReference];
      
      // Determinar los días del plan
      let days = 30; // Por defecto mensual
      let planType = 'monthly';
      
      if (pendingData) {
        days = pendingData.days;
        planType = pendingData.plan;
        // Limpiar pago pendiente
        delete pendingPayments[externalReference];
        savePendingPayments(pendingPayments);
      }
      
      // Activar Pro
      if (status === 'authorized' || status === 'active') {
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + days);
        
        proStatus[externalReference] = {
          status: 'active',
          plan: planType,
          expirationDate: expirationDate.toISOString(),
          activatedAt: new Date().toISOString(),
          email: payerEmail
        };
        saveProStatus(proStatus);
        
        console.log(`✅ Usuario ${externalReference} activado como Pro hasta ${expirationDate.toISOString()}`);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).send('Error');
  }
});

// Endpoint manual para activar Pro (fallback si webhook falla)
app.post('/api/activate-manual', (req, res) => {
  try {
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
    
    console.log(`✅ Activación manual: Usuario ${userId} Pro hasta ${expirationDate.toISOString()}`);
    res.json({ success: true, expirationDate: expirationDate.toISOString() });
  } catch (error) {
    console.error('❌ Error en activación manual:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});
