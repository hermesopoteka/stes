require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const {
  PostManager,
  PredictionManager,
  ResultManager,
  UserStatsManager,
  SessionManager,
  BackupManager
} = require('./data-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN) : null;

// Trust proxy
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', './views');

// ============================================
// SECURITY MIDDLEWARE
// ============================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "https://api.telegram.org"],
      mediaSrc: ["'self'", "https://api.telegram.org"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',') 
        : ["'self'"]
    }
  },
  frameguard: false
}));

// CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['https://tamie-presphenoid-shonta.ngrok-free.dev'];

// CORS - Basitleştirilmiş versiyon (development için) 
// Cors Devredışı
//app.use(cors({
  //origin: true, // Tüm origin'lere izin ver
  //credentials: true
//}));


app.use(cors({
  origin: function(origin, callback) {
    // ✅ FIX: Allow requests with no origin
    // (same-domain requests, server-side forms, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow all localhost origins for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Check allowed origins list
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // For admin pages and same-origin requests, allow them
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser
app.use(cookieParser(process.env.COOKIE_SECRET || 'change-this-secret'));

// Static files
app.use(express.static('public'));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/admin')
});

const predictionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.signedCookies.userToken || req.ip,
  message: 'Çok hızlı tahmin yapıyorsunuz. Lütfen bekleyin.'
});

app.use(generalLimiter);

// ============================================
// UTILITY FUNCTIONS
// ============================================

function escape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateScore(score) {
  const num = parseInt(score);
  return !isNaN(num) && num >= 0 && num <= 99;
}

function validateRumuz(rumuz) {
  if (!rumuz || typeof rumuz !== 'string') return false;
  const cleaned = rumuz.trim();
  return cleaned.length >= 2 && cleaned.length <= 30 && /^[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+$/.test(cleaned);
}

function isPredictionOpen(post) {
  if (!post) return false;
  if (!post.deadline) return true;
  return new Date() < new Date(post.deadline);
}

async function getOrCreateUserToken(req, res) {
  let userToken = req.signedCookies.userToken;
  
  if (!userToken) {
    userToken = crypto.randomUUID();
    res.cookie('userToken', userToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      signed: true,
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  }
  
  return userToken;
}

// ============================================
// WIDGET ENDPOINTS
// ============================================

app.get('/widget/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const post = PostManager.getById(postId);
    
    if (!post) {
      return res.status(404).send('Etkinlik bulunamadı');
    }

    const predictions = PredictionManager.getByPostId(postId, false);
    const predictionCount = PredictionManager.getCount(postId);
    const predictionOpen = isPredictionOpen(post);
    const userToken = await getOrCreateUserToken(req, res);
    
    const telegramId = req.signedCookies.tgId;
    const hasAlreadyPredicted = PredictionManager.checkDuplicate(postId, telegramId, userToken);

    res.render('widget', {
      post: { id: postId, ...post },
      predictions,
      predictionCount,
      predictionOpen,
      hasAlreadyPredicted,
      error: req.query.error,
      success: req.query.success,
      escape
    });
  } catch (error) {
    console.error('Widget error:', error);
    res.status(500).send('Bir hata oluştu');
  }
});

app.get('/widget/:postId/form', async (req, res) => {
  try {
    const { postId } = req.params;
    const post = PostManager.getById(postId);
    
    if (!post) {
      return res.status(404).send('Etkinlik bulunamadı');
    }

    const predictionOpen = isPredictionOpen(post);
    const userToken = await getOrCreateUserToken(req, res);
    const telegramId = req.signedCookies.tgId;
    const hasAlreadyPredicted = PredictionManager.checkDuplicate(postId, telegramId, userToken);

    res.render('prediction-form', {
      post: { id: postId, ...post },
      predictionOpen,
      hasAlreadyPredicted,
      error: req.query.error,
      escape
    });
  } catch (error) {
    console.error('Form error:', error);
    res.status(500).send('Bir hata oluştu');
  }
});

app.get('/widget/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaders = UserStatsManager.getLeaderboard(limit);
    
    res.render('leaderboard', {
      leaders,
      escape
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).send('Bir hata oluştu');
  }
});

// ============================================
// PREDICTION ENDPOINTS
// ============================================

app.post('/api/predict/:postId', predictionLimiter, async (req, res) => {
  try {
    const { postId } = req.params;
    const { home, away, rumuz, hidden } = req.body;

    if (!validateScore(home) || !validateScore(away)) {
      return res.status(400).json({ 
        error: 'Geçersiz skor. 0-99 arası bir değer girin.' 
      });
    }

    if (!validateRumuz(rumuz)) {
      return res.status(400).json({ 
        error: 'Kullanıcı adı 2-30 karakter olmalı ve sadece harf, rakam, alt çizgi içerebilir.' 
      });
    }

    const post = PostManager.getById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı' });
    }

    if (!isPredictionOpen(post)) {
      return res.status(403).json({ error: 'Tahmin süresi dolmuş' });
    }

    const userToken = req.signedCookies.userToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Geçersiz oturum' });
    }

    const telegramId = req.signedCookies.tgId || null;
    const username = req.signedCookies.tgUser || rumuz;

    console.log('telegram ID:', telegramId);

    const isDuplicate = PredictionManager.checkDuplicate(postId, telegramId, userToken);
    if (isDuplicate) {
      console.log('telegram ID:', telegramId);
      return res.status(409).json({ error: 'Bu etkinlik için zaten tahmin yaptınız' });
      
    }

    const predictionId = await PredictionManager.create(postId, {
      telegramId,
      username,
      rumuz: rumuz.trim(),
      homeScore: parseInt(home),
      awayScore: parseInt(away),
      userToken,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      isHidden: hidden === 'true' || hidden === true
    });

    if (telegramId) {
      await UserStatsManager.upsert(telegramId, username, rumuz.trim());
    }

    if (bot && post.channelId && post.messageId) {
      try {
        const newCount = PredictionManager.getCount(postId);
        await updateTelegramButton(postId, post, newCount);
      } catch (err) {
        console.error('Telegram button update error:', err);
      }
    }

    res.json({ 
      success: true, 
      predictionId,
      message: 'Tahmin başarıyla kaydedildi!' 
    });

  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: 'Bir hata oluştu. Lütfen tekrar deneyin.' });
  }
});

async function updateTelegramButton(postId, post, count) {
  const keyboard = {
    inline_keyboard: [[
      {
        text: `⚽ Tahmin Yap (${count})`,
        url: `${process.env.BASE_URL}/widget/${postId}`
      }
    ]]
  };

  if (post.type === 'text') {
    await bot.editMessageText(post.text, {
      chat_id: post.channelId,
      message_id: post.messageId,
      reply_markup: keyboard
    });
  } else {
    await bot.editMessageCaption(post.text || '', {
      chat_id: post.channelId,
      message_id: post.messageId,
      reply_markup: keyboard
    });
  }
}

// ============================================
// API ENDPOINTS
// ============================================

app.get('/api/predictions/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const predictions = PredictionManager.getByPostId(postId, false);
    const paginatedPredictions = predictions.slice(offset, offset + limit);
    
    res.json({
      predictions: paginatedPredictions,
      total: predictions.length,
      page,
      hasMore: offset + limit < predictions.length
    });
  } catch (error) {
    console.error('Get predictions error:', error);
    res.status(500).json({ error: 'Bir hata oluştu' });
  }
});

app.get('/api/stats/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const stats = PredictionManager.getStats(postId);
    const popular = PredictionManager.getPopularScores(postId, 5);
    
    res.json({ stats, popular });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Bir hata oluştu' });
  }
});

app.get('/media/:postId', async (req, res) => {
  try {
    const post = PostManager.getById(req.params.postId);
    
    if (!post || !post.fileId) {
      return res.status(404).send('Medya bulunamadı');
    }

    if (!bot) {
      return res.status(500).send('Bot yapılandırması eksik');
    }

    const file = await bot.getFile(post.fileId);
    const telegramUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const response = await fetch(telegramUrl);
    if (!response.ok) {
      return res.status(404).send('Dosya bulunamadı');
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader(
      'Content-Type',
      post.type === 'photo' ? 'image/jpeg' : 'video/mp4'
    );
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    res.send(buffer);

  } catch (err) {
    console.error('Media proxy error:', err);
    res.status(500).send('Medya yüklenemedi');
  }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

function basicAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }

  const base64 = auth.split(' ')[1];
  const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');

  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).send('Invalid credentials');
}


// Admin GET Endpoint'leri
// Bu kodu server.js dosyasına, mevcut admin POST endpoint'lerinin ÜZERİNE ekleyin

// ============================================
// ADMIN GET ENDPOINTS (Sayfaları göster)
// ============================================

// Ana admin paneli (dashboard)
app.get('/admin', basicAuth, async (req, res) => {
  try {
    const posts = PostManager.getAll();
    const activePosts = PostManager.getActive();
    const { PredictionManager } = require('./data-manager');
    const allPredictions = PredictionManager.getAll();
    
    const totalPosts = Object.keys(posts).length;
    const totalPredictions = Object.values(allPredictions).reduce((sum, arr) => sum + arr.length, 0);

    res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel</title>
  <link rel="stylesheet" href="/css/iframe.css">
</head>
<body>
  <div class="iframe-container">
    <div class="card">
      <h1 class="card-title">🎯 Admin Panel</h1>
      
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">${totalPosts}</span>
          <span class="stat-label">Toplam Etkinlik</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${activePosts.length}</span>
          <span class="stat-label">Aktif Etkinlik</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${totalPredictions}</span>
          <span class="stat-label">Toplam Tahmin</span>
        </div>
      </div>

      <h2>📋 Son Etkinlikler</h2>
      <div style="max-height: 400px; overflow-y: auto;">
        ${Object.entries(posts).slice(0, 10).map(([id, post]) => `
          <div class="prediction-item">
            <div class="prediction-user">
              <span class="prediction-username">${post.title || post.text?.substring(0, 50) || 'Başlıksız'}</span>
              <span class="prediction-rumuz">${new Date(post.createdAt).toLocaleDateString('tr-TR')}</span>
            </div>
            <div>
              <a href="/admin/result/${id}" class="btn btn-sm btn-primary">Yönet</a>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </div>
</body>
</html>
    `);
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).send('Bir hata oluştu');
  }
});

// Sonuç giriş sayfası (GET)
/*
app.get('/admin/result/:postId', basicAuth, (req, res) => {
  const { postId } = req.params;
  const post = PostManager.getById(postId);


 const currentDeadline = post.deadline 
    ? new Date(post.deadline).toISOString().slice(0, 16)
    : '';

//const dateToday = (this.kapanis.getFullYear() + '-' + ((this.kapanis.getMonth() + 1)) + '-' + this.kapanis.getDate() + ' ' +this.kapanis.getHours() + ':' + this.kapanis.getMinutes()+ ':' + this.kapanis.getSeconds());
//console.log('today date', this.dateToday);

  if (!post) {
    return res.status(404).send('Etkinlik bulunamadı');
  }

  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maç Sonucu Gir</title>
  <link rel="stylesheet" href="/css/iframe.css">
</head>
<body>
  <div class="iframe-container">
    <div class="card">
      <h2 class="card-title">⚽ Maç Sonucu Gir</h2>
      
      ${post.title ? `<p><strong>Etkinlik:</strong> ${post.title}</p>` : ''}
      ${post.homeTeam && post.awayTeam ? `<p><strong>Maç:</strong> ${post.homeTeam} - ${post.awayTeam}</p>` : ''}
      ${post.deadline ? `<p><strong>Tahmin Kapanış Zamanı:</strong> ${currentDeadline}</p>` : ''}

      <form method="POST" action="/admin/result/${postId}">
        <div class="form-group">
          <label class="form-label">Ev Sahibi Skor</label>
          <input type="number" name="home" class="form-input" placeholder="0" required min="0" max="99">
        </div>

        <div class="form-group">
          <label class="form-label">Deplasman Skor</label>
          <input type="number" name="away" class="form-input" placeholder="0" required min="0" max="99">
        </div>

        <button type="submit" class="btn btn-primary btn-block">🏆 Sonucu Kaydet</button>
      </form>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; gap: 12px; justify-content: space-between;">
        <a href="/admin/deadline/${postId}" class="btn btn-sm">⏰ Deadline</a>
        <a href="/admin/title/${postId}" class="btn btn-sm">✏️ Başlık</a>
        <a href="/widget/${postId}" class="btn btn-sm" target="_blank">👁️ Widget</a>
      </div>
    </div>
  </div>
</body>
</html>
  `);
});
*/

// Admin GET endpoints
app.get('/admin/result/:postId', basicAuth, (req, res) => {
  const { postId } = req.params;
  const post = PostManager.getById(postId);

  if (!post) {
    return res.status(404).send('Etkinlik bulunamadı');
  }

  const predictionCount = PredictionManager.getCount(postId);
  const result = ResultManager.getByPostId(postId);
  const winners = result ? ResultManager.getWinners(postId) : [];

  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maç Sonucu Yönetimi</title>
  <link rel="stylesheet" href="/css/iframe.css">
</head>
<body>
  <div class="iframe-container">
    <div class="card">
      <h2 class="card-title">⚽ Maç Sonucu Yönetimi</h2>
      
      <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 16px;">
        ${post.title ? `<p><strong>Başlık:</strong> ${post.title}</p>` : ''}
        ${post.homeTeam && post.awayTeam ? `<p><strong>Maç:</strong> ${post.homeTeam} - ${post.awayTeam}</p>` : ''}
        <p><strong>Toplam Tahmin:</strong> ${predictionCount}</p>
        ${post.deadline ? `<p><strong>Deadline:</strong> ${new Date(post.deadline).toLocaleString('tr-TR')}</p>` : ''}
      </div>

      ${result ? `
        <!-- Sonuç Girilmiş -->
        <div class="alert alert-success">
          ✅ Bu etkinlik için sonuç girilmiş
        </div>

        <div class="card" style="background: var(--bg-tertiary); margin-bottom: 16px;">
          <h3 style="margin-bottom: 12px;">📊 Kayıtlı Sonuç</h3>
          <div style="font-size: 32px; font-weight: bold; color: var(--accent); text-align: center; padding: 20px 0;">
            ${result.homeScore} - ${result.awayScore}
          </div>
          <p style="text-align: center; color: var(--text-muted); font-size: 14px;">
            Girilme Tarihi: ${new Date(result.createdAt).toLocaleString('tr-TR')}
          </p>
        </div>

        <!-- Kazananlar Listesi -->
        <div class="card">
          <h3>🏆 Doğru Tahmin Yapanlar (${winners.length})</h3>
          
          ${winners.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">😔</div>
              <div class="empty-state-title">Kimse doğru tahmin yapmadı</div>
            </div>
          ` : `
            <div class="predictions-list" style="max-height: 400px; overflow-y: auto;">
              ${winners.map((w, index) => `
                <div class="prediction-item">
                  <div class="prediction-user">
                    <span class="prediction-username">
                      ${index + 1}. @${w.username}
                    </span>
                    <span class="prediction-rumuz">(${w.rumuz})</span>
                  </div>
                  <span class="prediction-score" style="color: var(--success);">
                    ✓ ${w.homeScore} - ${w.awayScore}
                  </span>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Sonucu Düzenle Butonu -->
        <div style="margin-top: 16px;">
          <button 
            id="edit-button"
            class="btn btn-primary btn-block"
          >
            ✏️ Sonucu Düzenle
          </button>
        </div>

        <!-- Düzenleme Formu (Gizli) -->
        <div id="edit-form" style="display: none; margin-top: 16px;">
          <div class="alert alert-warning">
            ⚠️ Sonucu değiştirmek kazananları ve puanları sıfırlayacak!
          </div>

          <form method="POST" action="/admin/result/${postId}">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">${post.homeTeam || 'Ev Sahibi'} Skor</label>
                <input 
                  type="number" 
                  name="home" 
                  class="form-input" 
                  placeholder="0" 
                  required 
                  min="0" 
                  max="99"
                  value="${result.homeScore}"
                >
              </div>

              <div class="form-group">
                <label class="form-label">${post.awayTeam || 'Deplasman'} Skor</label>
                <input 
                  type="number" 
                  name="away" 
                  class="form-input" 
                  placeholder="0" 
                  required 
                  min="0" 
                  max="99"
                  value="${result.awayScore}"
                >
              </div>
            </div>

            <div style="display: flex; gap: 12px;">
              <button type="submit" class="btn btn-primary" style="flex: 1;">
                💾 Güncelle
              </button>
              <button 
                type="button" 
                id="cancel-button"
                class="btn"
                style="flex: 1;"
              >
                ✕ İptal
              </button>
            </div>
          </form>
        </div>

        <script>
          document.addEventListener('DOMContentLoaded', function() {
            const editForm = document.getElementById('edit-form');
            const editButton = document.getElementById('edit-button');
            const cancelButton = document.getElementById('cancel-button');
            
            if (editButton) {
              editButton.addEventListener('click', function() {
                editForm.style.display = 'block';
                editButton.style.display = 'none';
              });
            }
            
            if (cancelButton) {
              cancelButton.addEventListener('click', function() {
                editForm.style.display = 'none';
                editButton.style.display = 'block';
              });
            }
          });
        </script>

      ` : `
        <!-- Sonuç Girilmemiş -->
        <div class="alert alert-warning">
          ⚠️ Bu etkinlik için henüz sonuç girilmemiş
        </div>

        <form method="POST" action="/admin/result/${postId}">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">${post.homeTeam || 'Ev Sahibi'} Skor</label>
              <input 
                type="number" 
                name="home" 
                class="form-input" 
                placeholder="0" 
                required 
                min="0" 
                max="99"
              >
            </div>

            <div class="form-group">
              <label class="form-label">${post.awayTeam || 'Deplasman'} Skor</label>
              <input 
                type="number" 
                name="away" 
                class="form-input" 
                placeholder="0" 
                required 
                min="0" 
                max="99"
              >
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-block">
            🏆 Sonucu Kaydet
          </button>
        </form>
      `}

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; gap: 12px; flex-wrap: wrap;">
        <a href="/admin/deadline/${postId}" class="btn btn-sm">⏰ Deadline Ayarla</a>
        <a href="/admin/title/${postId}" class="btn btn-sm">✏️ Başlık Düzenle</a>
        <a href="/widget/${postId}" class="btn btn-sm" target="_blank">👁️ Widget Görünümü</a>
      </div>
    </div>
  </div>
</body>
</html>
  `);
});

// Deadline ayarlama sayfası (GET)
app.get('/admin/deadline/:postId', basicAuth, (req, res) => {
  const { postId } = req.params;
  const post = PostManager.getById(postId);

  if (!post) {
    return res.status(404).send('Etkinlik bulunamadı');
  }

  const currentDeadline = post.deadline 
    ? new Date(post.deadline).toISOString().slice(0, 16)
    : '';

  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deadline Ayarla</title>
  <link rel="stylesheet" href="/css/iframe.css">
</head>
<body>
  <div class="iframe-container">
    <div class="card">
      <h2 class="card-title">🕒 Tahmin Kapanış Zamanı</h2>
      
      ${post.title ? `<p><strong>Etkinlik:</strong> ${post.title}</p>` : ''}

      <form method="POST" action="/admin/deadline/${postId}">
        <div class="form-group">
          <label class="form-label">Kapanış Zamanı</label>
          <input 
            type="datetime-local" 
            name="deadline" 
            class="form-input" 
            value="${currentDeadline}"
            required
          >
        </div>

        <button type="submit" class="btn btn-primary btn-block">💾 Kaydet</button>
      </form>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
        <a href="/admin/result/${postId}" class="btn btn-sm">← Geri</a>
      </div>
    </div>
  </div>
</body>
</html>
  `);
});

// Başlık düzenleme sayfası (GET)
app.get('/admin/title/:postId', basicAuth, (req, res) => {
  const { postId } = req.params;
  const post = PostManager.getById(postId);

  if (!post) {
    return res.status(404).send('Etkinlik bulunamadı');
  }

  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Başlık Düzenle</title>
  <link rel="stylesheet" href="/css/iframe.css">
</head>
<body>
  <div class="iframe-container">
    <div class="card">
      <h2 class="card-title">📝 Etkinlik Bilgileri</h2>

      <form method="POST" action="/admin/title/${postId}">
        <div class="form-group">
          <label class="form-label">Başlık</label>
          <input 
            type="text" 
            name="title" 
            class="form-input" 
            placeholder="Örn: Süper Lig Derbi"
            value="${post.title || ''}"
          >
        </div>

        <div class="form-group">
          <label class="form-label">Ev Sahibi Takım</label>
          <input 
            type="text" 
            name="homeTeam" 
            class="form-input" 
            placeholder="Örn: Galatasaray"
            value="${post.homeTeam || ''}"
          >
        </div>

        <div class="form-group">
          <label class="form-label">Deplasman Takım</label>
          <input 
            type="text" 
            name="awayTeam" 
            class="form-input" 
            placeholder="Örn: Fenerbahçe"
            value="${post.awayTeam || ''}"
          >
        </div>

        <button type="submit" class="btn btn-primary btn-block">💾 Kaydet</button>
      </form>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
        <a href="/admin/result/${postId}" class="btn btn-sm">← Geri</a>
      </div>
    </div>
  </div>
</body>
</html>
  `);
});

// Yedekleme sayfası (GET)
app.get('/admin/backup', basicAuth, (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const backupsDir = path.join(__dirname, 'backups');
  
  let backups = [];
  if (fs.existsSync(backupsDir)) {
    backups = fs.readdirSync(backupsDir)
      .filter(name => fs.statSync(path.join(backupsDir, name)).isDirectory())
      .map(name => {
        const stat = fs.statSync(path.join(backupsDir, name));
        return {
          name,
          date: stat.mtime,
          size: getDirectorySize(path.join(backupsDir, name))
        };
      })
      .sort((a, b) => b.date - a.date);
  }

  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yedekleme</title>
  <link rel="stylesheet" href="/css/iframe.css">
</head>
<body>
  <div class="iframe-container">
    <div class="card">
      <h2 class="card-title">💾 Yedekleme</h2>

      <form method="POST" action="/admin/backup">
        <button type="submit" class="btn btn-success btn-block">
          📦 Yeni Yedek Oluştur
        </button>
      </form>

      <h3 style="margin-top: 24px; margin-bottom: 12px;">Mevcut Yedekler (${backups.length})</h3>
      
      ${backups.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📁</div>
          <div class="empty-state-title">Henüz yedek yok</div>
        </div>
      ` : `
        <div style="max-height: 400px; overflow-y: auto;">
          ${backups.map(backup => `
            <div class="prediction-item">
              <div class="prediction-user">
                <span class="prediction-username">📦 ${backup.name}</span>
                <span class="prediction-rumuz">${new Date(backup.date).toLocaleString('tr-TR')} · ${formatBytes(backup.size)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `}

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
        <a href="/admin" class="btn btn-sm">← Ana Panel</a>
      </div>
    </div>
  </div>

  <script>
    function formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
  </script>
</body>
</html>
  `);
});

function getDirectorySize(dirPath) {
  const fs = require('fs');
  const path = require('path');
  let size = 0;
  
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        size += stats.size;
      }
    });
  } catch (err) {
    console.error('Error getting directory size:', err);
  }
  
  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}


app.post('/admin/result/:postId', basicAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { home, away } = req.body;

    if (!validateScore(home) || !validateScore(away)) {
      return res.status(400).send('Geçersiz skor');
    }

    await ResultManager.create(postId, parseInt(home), parseInt(away));

    const winners = ResultManager.getWinners(postId);
    const post = PostManager.getById(postId);
    
    for (const winner of winners) {
      if (winner.telegramId) {
        await UserStatsManager.updateCorrect(winner.telegramId);
        
        if (bot) {
          try {
            await bot.sendMessage(
              winner.telegramId,
              `🎉 Tebrikler! "${post.title || 'Etkinlik'}" için ${home}-${away} tahmininiz doğru çıktı!\n\n+10 puan kazandınız! 🏆`
            );
          } catch (err) {
            console.error(`Bildirim gönderilemedi: ${winner.telegramId}`, err);
          }
        }
      }
    }

    res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sonuç Kaydedildi</title>
  <link rel="stylesheet" href="/css/iframe.css">
</head>
<body>
  <div class="iframe-container">
    <div class="card">
      <div class="alert alert-success">
        ✅ Sonuç başarıyla kaydedildi!
      </div>

      <h2 class="card-title">⚽ Maç Sonucu: ${home} - ${away}</h2>
      <h3>Doğru Tahmin Yapanlar (${winners.length})</h3>

      ${winners.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">😔</div>
          <div class="empty-state-title">Kimse doğru tahmin yapmadı</div>
        </div>
      ` : `
        <ul style="list-style: none; padding: 0;">
          ${winners.map(w => `
            <li class="prediction-item">
              <div class="prediction-user">
                <span class="prediction-username">@${w.username}</span>
                <span class="prediction-rumuz">(${w.rumuz})</span>
              </div>
              <span class="prediction-score">+10 puan</span>
            </li>
          `).join('')}
        </ul>
      `}

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; gap: 12px;">
        <a href="/admin/result/${postId}" class="btn btn-sm">← Tekrar Düzenle</a>
        <a href="/widget/${postId}" class="btn btn-sm" target="_blank">👁️ Widget</a>
      </div>
    </div>
  </div>
</body>
</html>
    `);

  } catch (error) {
    console.error('Result error:', error);
    res.status(500).send('Bir hata oluştu: ' + error.message);
  }
});

app.post('/admin/title/:postId', basicAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { title, homeTeam, awayTeam } = req.body;

    // Log everything for debugging
    console.log('=== TITLE UPDATE DEBUG ===');
    console.log('postId:', postId);
    console.log('body:', req.body);
    console.log('title:', title);
    console.log('homeTeam:', homeTeam);
    console.log('awayTeam:', awayTeam);

    // Check if PostManager exists
    if (!PostManager) {
      throw new Error('PostManager is not defined');
    }

    // Get post
    const post = PostManager.getById(postId);
    console.log('Found post:', post ? 'YES' : 'NO');
    
    if (!post) {
      return res.status(404).send('Etkinlik bulunamadı');
    }

    // Update
    const updateData = {
      title: title?.trim() || null,
      homeTeam: homeTeam?.trim() || null,
      awayTeam: awayTeam?.trim() || null
    };
    
    console.log('Updating with:', updateData);
    
    await PostManager.update(postId, updateData);
    
    console.log('Update successful!');

    // Simple HTML response (no escape needed for now)
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Başarılı</title>
</head>
<body>
  <h1>Başarılı!</h1>
  <p>Başlık: ${title || '(boş)'}</p>
  <p>Ev Sahibi: ${homeTeam || '(boş)'}</p>
  <p>Deplasman: ${awayTeam || '(boş)'}</p>
  <a href="/admin/result/${postId}">Geri Dön</a>
</body>
</html>
    `);

  } catch (error) {
    console.error('=== ERROR ===');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    
    res.status(500).send(`
<!DOCTYPE html>
<html>
<head><title>Hata</title></head>
<body>
  <h1>Hata Oluştu</h1>
  <pre>${error.message}\n\n${error.stack}</pre>
  <a href="/admin">Geri</a>
</body>
</html>
    `);
  }
});

app.post('/admin/deadline/:postId', basicAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { deadline } = req.body;

    if (!deadline) {
      return res.status(400).json({ error: 'Deadline gerekli' });
    }

    await PostManager.update(postId, { 
      deadline: new Date(deadline).toISOString() 
    });

    //res.json({ success: true });
        res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Başarılı</title>
</head>
<body>
  <h1>Başarılı!</h1>
  <p>Kapanış Zamanı: ${deadline || '(boş)'}</p>

  <a href="/admin/result/${postId}">Geri Dön</a>
</body>
</html>
    `);

  } catch (error) {
    console.error('Deadline error:', error);
    res.status(500).json({ error: 'Bir hata oluştu' });
  }
});

app.post('/admin/title/:postId', basicAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { title, homeTeam, awayTeam } = req.body;

    await PostManager.update(postId, { 
      title: title?.trim() || null,
      homeTeam: homeTeam?.trim() || null,
      awayTeam: awayTeam?.trim() || null
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Title update error:', error);
    res.status(500).json({ error: 'Bir hata oluştu' });
  }
});

// Backup endpoint
app.post('/admin/backup', basicAuth, (req, res) => {
  try {
    const backupPath = BackupManager.create();
    res.json({ success: true, backupPath });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Yedekleme başarısız' });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    bot: !!bot,
    storage: 'json'
  });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================
// STARTUP
// ============================================

async function startServer() {
  try {
    // Cleanup expired sessions daily
    setInterval(async () => {
      try {
        const cleaned = await SessionManager.cleanup();
        console.log(`✅ Cleaned ${cleaned} expired sessions`);
      } catch (err) {
        console.error('Session cleanup error:', err);
      }
    }, 24 * 60 * 60 * 1000);

    // Auto backup every 6 hours
    setInterval(() => {
      try {
        BackupManager.create();
        BackupManager.cleanOld(7); // Keep 7 days
      } catch (err) {
        console.error('Auto backup error:', err);
      }
    }, 6 * 60 * 60 * 1000);

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Widget URL: http://localhost:${PORT}/widget/POST_ID`);
      console.log(`🏆 Leaderboard: http://localhost:${PORT}/widget/leaderboard`);
      console.log(`💾 Storage: JSON files`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
