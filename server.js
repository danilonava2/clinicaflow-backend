require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

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

// ==================== LINKS DE PAGO REALES ====================
const LINKS_PAGO = {
  monthly: 'https://mpago.la/19YCv1c',
  yearly: 'https://mpago.la/19YCv1c'  // Cambiar cuando tengas el link anual
};

app.post('/api/create-payment', (req, res) => {
  try {
    const { planType, userId } = req.body;
    
    console.log(`📝 Solicitud de pago: plan=${planType}, userId=${userId}`);
    
    const planConfig = {
      monthly: { days: 30, price: 10 },
      yearly: { days: 365, price: 100 }
    };
    
    const plan = planConfig[planType];
    if (!plan) {
      return res.status(400).json({ error: 'Plan no válido' });
    }
    
    const pendingFile = './pending-payments.json';
    let pending = {};
    try {
      if (fs.existsSync(pendingFile)) {
        pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      }
    } catch(e) {}
    
    pending[userId] = {
      plan: planType,
      days: plan.days,
      createdAt: Date.now()
    };
    fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2));
    
    res.json({ 
      success: true, 
      url: LINKS_PAGO[planType],
      message: 'Serás redirigido a Mercado Pago para completar el pago.'
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/webhook', (req, res) => {
  console.log('🔔 Webhook recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const externalReference = data.external_reference;
      const status = data.status;
      
      console.log(`📝 Pago: Ref=${externalReference}, Estado=${status}`);
      
      if (status === 'approved') {
        const pendingFile = './pending-payments.json';
        let pending = {};
        try {
          if (fs.existsSync(pendingFile)) {
            pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
          }
        } catch(e) {}
        
        const pendingData = pending[externalReference];
        if (pendingData) {
          const days = pendingData.days;
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + days);
          
          proStatus[externalReference] = {
            status: 'active',
            plan: pendingData.plan,
            expirationDate: expirationDate.toISOString(),
            activatedAt: new Date().toISOString()
          };
          saveProStatus(proStatus);
          
          delete pending[externalReference];
          fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2));
          
          console.log(`✅ Usuario ${externalReference} activado como Pro hasta ${expirationDate.toISOString()}`);
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).send('Error');
  }
});

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
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});
