# 🎯 CNBR Tahmin Sistemi v2.0 - Standalone

JSON dosyaları kullanan, basit ve hafif tahmin etkinliği sistemi. İframe desteği ile her web sitesine kolayca entegre edilebilir.

## ✨ Özellikler

- ✅ **JSON Depolama**: Basit dosya tabanlı veri saklama (veritabanı gerekmez)
- ✅ **İframe Desteği**: Herhangi bir web sitesine entegre edilebilir
- ✅ **Telegram Entegrasyonu**: Otomatik post paylaşımı ve bildirimler
- ✅ **Otomatik Yedekleme**: Her 6 saatte bir otomatik yedek
- ✅ **Lock Mekanizması**: Race condition koruması
- ✅ **Gerçek Zamanlı İstatistikler**: Anlık tahmin istatistikleri
- ✅ **Liderlik Tablosu**: Puan sistemi ve kullanıcı sıralaması
- ✅ **Responsive Design**: Mobil uyumlu modern arayüz
- ✅ **Güvenlik**: Rate limiting, CSRF koruması, input validation

## 📋 Gereksinimler

- Node.js >= 18.0.0
- npm >= 9.0.0
- Telegram Bot Token
- HTTPS (production için)

## 🚀 Kurulum

### 1. Projeyi İndirin

```bash
git clone https://github.com/yourcompany/cnbr-prediction-standalone.git
cd cnbr-prediction-standalone
```

### 2. Bağımlılıkları Yükleyin

```bash
npm install
```

### 3. Ortam Değişkenlerini Ayarlayın

`.env.example` dosyasını `.env` olarak kopyalayın:

```bash
cp .env.example .env
```

`.env` dosyasını düzenleyin:

```env
NODE_ENV=production
PORT=3000
BASE_URL=https://your-domain.com

COOKIE_SECRET=your-random-32-char-secret
ADMIN_USER=admin
ADMIN_PASS=strong-password-here

BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHANNELS=@your_channel
ADMIN_IDS=123456789

ALLOWED_ORIGINS=https://your-website.com
```

### 4. Sistemi Başlatın

**Geliştirme ortamı:**
```bash
npm run dev:all  # Server + Bot birlikte
```

**Production:**
```bash
npm start  # Sadece server
npm run bot  # Ayrı terminalden bot
```

veya PM2 ile:

```bash
pm2 start ecosystem.config.js
```

## 📦 Proje Yapısı

```
prediction-standalone/
├── data-manager.js      # JSON veri yönetimi
├── server.js           # Express server
├── bot.js              # Telegram bot
├── package.json        # NPM dependencies
├── .env                # Ortam değişkenleri
│
├── data/               # JSON veri dosyaları (otomatik oluşur)
│   ├── posts.json
│   ├── predictions.json
│   ├── results.json
│   ├── user-stats.json
│   └── sessions.json
│
├── backups/            # Otomatik yedekler (otomatik oluşur)
│   └── YYYY-MM-DD_HH-MM-SS/
│
├── public/
│   ├── css/
│   │   └── iframe.css
│   └── js/
│       └── iframe-communication.js
│
└── views/
    ├── widget.ejs
    └── leaderboard.ejs
```

## 💾 Veri Yönetimi

### JSON Dosyaları

Tüm veriler `data/` klasöründe JSON dosyaları olarak saklanır:

- **posts.json**: Etkinlik bilgileri
- **predictions.json**: Kullanıcı tahminleri
- **results.json**: Maç sonuçları
- **user-stats.json**: Kullanıcı istatistikleri
- **sessions.json**: Oturum bilgileri

### Otomatik Yedekleme

Sistem her 6 saatte bir otomatik yedek alır:

```bash
backups/
├── 2024-03-15_10-00-00/
├── 2024-03-15_16-00-00/
└── 2024-03-15_22-00-00/
```

Son 7 günün yedekleri saklanır.

### Manuel Yedekleme

```bash
npm run backup
```

veya Telegram bot ile:

```
/backup
```

### Yedek Geri Yükleme

```bash
node scripts/restore-backup.js backups/2024-03-15_10-00-00
```

## 🎮 Kullanım

### Telegram Bot ile Etkinlik Oluşturma

1. Telegram'da botunuza `/start` yazın
2. Metin, fotoğraf veya video gönderin
3. Bot otomatik olarak:
   - UUID oluşturur
   - Belirlenen kanallara post yapar
   - Size widget URL'ini gönderir

**Örnek mesaj:**

```
Galatasaray - Fenerbahçe
18.03 20:00
Tahminlerinizi yapın! 🔥
```

### Web Sitenize Entegrasyon

Detaylı entegrasyon kılavuzu için: [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)

**Hızlı başlangıç:**

```html
<div id="cnbr-widget"></div>

<script>
  (function() {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://your-domain.com/widget/POST_ID';
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    document.getElementById('cnbr-widget').appendChild(iframe);
    
    window.addEventListener('message', function(event) {
      if (event.data.type === 'cnbr_resize') {
        iframe.style.height = event.data.data.height + 'px';
      }
    });
  })();
</script>
```

## 🔧 Admin İşlemleri

### Sonuç Girme

```bash
POST /admin/result/:postId
Authorization: Basic admin:password
Content-Type: application/json

{
  "home": 3,
  "away": 1
}
```

### Deadline Ayarlama

```bash
POST /admin/deadline/:postId
Authorization: Basic admin:password
Content-Type: application/json

{
  "deadline": "2024-03-18T20:00:00"
}
```

### Başlık Düzenleme

```bash
POST /admin/title/:postId
Authorization: Basic admin:password
Content-Type: application/json

{
  "title": "Süper Lig Derbi",
  "homeTeam": "Galatasaray",
  "awayTeam": "Fenerbahçe"
}
```

## 📊 API Endpoints

### Public Endpoints

#### Widget Sayfası
```
GET /widget/:postId
```

#### Liderlik Tablosu
```
GET /widget/leaderboard?limit=10
```

#### Tahmin Gönderme
```
POST /api/predict/:postId
Content-Type: application/json

{
  "rumuz": "user123",
  "home": 2,
  "away": 1,
  "hidden": false
}
```

#### Tahminleri Getir
```
GET /api/predictions/:postId?page=1&limit=20
```

#### İstatistikler
```
GET /api/stats/:postId
```

## 🔒 Güvenlik

### Lock Mekanizması

Aynı anda birden fazla yazma işlemini önlemek için async lock kullanır:

```javascript
async function withLock(lockName, callback) {
  while (locks[lockName]) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  locks[lockName] = true;
  
  try {
    return await callback();
  } finally {
    locks[lockName] = false;
  }
}
```

### Güvenlik Önlemleri

- ✅ **HTTPS Zorunlu** (production)
- ✅ **CORS Koruması**
- ✅ **Rate Limiting**
- ✅ **Input Validation**
- ✅ **Helmet.js**
- ✅ **Signed Cookies**
- ✅ **Duplicate Prevention**

## 📈 Performans

### Avantajlar

- ✅ Veritabanı kurulumu gerektirmez
- ✅ Basit deployment
- ✅ Hızlı başlangıç
- ✅ Kolay yedekleme
- ✅ Düşük sistem gereksinimleri

### Sınırlamalar

- ⚠️ Çok yüksek trafikte (1000+ eşzamanlı kullanıcı) performans düşebilir
- ⚠️ Dosya bazlı arama SQLite'a göre daha yavaş
- ⚠️ Horizontal scaling için Redis gerekebilir

### Ne Zaman Veritabanına Geçmeli?

Şu durumlarda SQLite versiyonunu kullanın:

- Günlük 10.000+ tahmin
- 100+ eşzamanlı etkinlik
- Karmaşık sorgular gerekiyor
- Production ortamında yüksek trafik

## 🔄 Migrasyon

### JSON'dan SQLite'a Geçiş

```javascript
// migrate-to-sqlite.js
const { PostManager, PredictionManager } = require('./data-manager');
const sqlite = require('./database'); // SQLite version

async function migrate() {
  const posts = PostManager.getAll();
  
  for (const [id, post] of Object.entries(posts)) {
    await sqlite.PostDB.create({ id, ...post });
  }
  
  // ... predictions, results, etc.
}

migrate();
```

## 🐛 Sorun Giderme

### Data Dosyaları Oluşmadı

```bash
# Manuel oluşturma
mkdir -p data backups
node -e "require('./data-manager').initializeFiles()"
```

### Lock Takıldı

Sunucuyu yeniden başlatın:

```bash
pm2 restart cnbr-prediction
```

### Yedek Bozuk

Son çalışan yedekten geri yükleyin:

```bash
ls -lt backups/
node scripts/restore-backup.js backups/YYYY-MM-DD_HH-MM-SS
```

## 📱 Production Deployment

### PM2 ile Deployment

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'cnbr-server',
      script: './server.js',
      instances: 1, // JSON için cluster mode önerilmez
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'cnbr-bot',
      script: './bot.js',
      instances: 1,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
```

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Docker ile Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create data directories
RUN mkdir -p data backups

EXPOSE 3000

CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    volumes:
      - ./data:/app/data
      - ./backups:/app/backups
    restart: unless-stopped
```

## 📞 Destek & Katkı

- 🐛 Bug Report: [GitHub Issues](https://github.com/yourcompany/cnbr-standalone/issues)
- 💡 Feature Request: [GitHub Discussions](https://github.com/yourcompany/cnbr-standalone/discussions)
- 📧 Email: support@yourcompany.com

## 📄 Lisans

MIT License

## 🔄 SQLite Versiyonu

Daha büyük projeler için SQLite kullanan versiyonu tercih edin:
[CNBR Prediction System (SQLite)](https://github.com/yourcompany/cnbr-prediction-system)

---

**Versiyon:** 2.0.0 (Standalone)  
**Depolama:** JSON  
**Son Güncelleme:** 2024
