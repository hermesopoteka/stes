require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const { PostManager } = require('./data-manager');

const TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHANNELS = process.env.TELEGRAM_CHANNELS 
  ? process.env.TELEGRAM_CHANNELS.split(',') 
  : [];

const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🤖 Telegram Bot started');

// Admin komutları
const ADMIN_IDS = process.env.ADMIN_IDS 
  ? process.env.ADMIN_IDS.split(',').map(Number) 
  : [];

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// Otomatik deadline parse et
function parseDeadline(text) {
  const match = text.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})/);
  
  if (match) {
    const [_, day, month, year, hour, minute] = match;
    const currentYear = new Date().getFullYear();
    const deadlineYear = year || currentYear;
    
    const deadline = new Date(deadlineYear, month - 1, day, hour, minute);
    
    if (deadline > new Date()) {
      return deadline.toISOString();
    }
  }
  
  return null;
}

// Otomatik takım isimleri parse et
function parseTeams(text) {
  const match = text.match(/([A-Za-zğüşıöçĞÜŞİÖÇ\s]+)\s+(?:-|vs\.?)\s+([A-Za-zğüşıöçĞÜŞİÖÇ\s]+)/i);
  
  if (match) {
    return {
      homeTeam: match[1].trim(),
      awayTeam: match[2].trim()
    };
  }
  
  return { homeTeam: null, awayTeam: null };
}

// Post oluştur ve kanala gönder
async function createAndPublishPost(msg, postData) {
  const postId = uuidv4();
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;

  const deadline = parseDeadline(postData.text || '');
  const { homeTeam, awayTeam } = parseTeams(postData.text || '');

  const widgetUrl = `${BASE_URL}/widget/${postId}?tg_id=${msg.from.id}&tg_name=${msg.from.username || msg.from.first_name}`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '⚽ Tahmin Yap (0)', url: widgetUrl }
    ]]
  };

  for (const channel of CHANNELS) {
    try {
      let sent;

      if (postData.type === 'text') {
        sent = await bot.sendMessage(channel, postData.text, {
          reply_markup: replyMarkup
        });
      } else if (postData.type === 'photo') {
        sent = await bot.sendPhoto(channel, postData.fileId, {
          caption: postData.text || '',
          reply_markup: replyMarkup
        });
      } else if (postData.type === 'video') {
        sent = await bot.sendVideo(channel, postData.fileId, {
          caption: postData.text || '',
          reply_markup: replyMarkup
        });
      }

      if (sent) {
        await PostManager.create({
          id: postId,
          type: postData.type,
          text: postData.text,
          fileId: postData.fileId,
          fileUrl: null,
          channelId: sent.chat.id,
          messageId: sent.message_id,
          title: null,
          deadline: deadline,
          homeTeam: homeTeam,
          awayTeam: awayTeam
        });

        console.log(`✅ Post created: ${postId} (Channel: ${channel})`);
        
        await bot.sendMessage(msg.chat.id, 
          `✅ Etkinlik oluşturuldu!\n\n` +
          `📋 ID: ${postId}\n` +
          `🔗 Widget URL: ${widgetUrl}\n` +
          (deadline ? `⏰ Deadline: ${new Date(deadline).toLocaleString('tr-TR')}\n` : '') +
          (homeTeam && awayTeam ? `⚽ ${homeTeam} - ${awayTeam}\n` : '') +
          `\nAdmin panelden başlık ve deadline düzenleyebilirsiniz.`
        );
      }

    } catch (error) {
      console.error(`Error publishing to ${channel}:`, error);
      await bot.sendMessage(msg.chat.id, 
        `❌ Hata: ${channel} kanalına gönderilemedi.\n${error.message}`
      );
    }
  }
}

// Mesaj handler
bot.on('message', async (msg) => {
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return bot.sendMessage(msg.chat.id, 
      '⛔ Bu botu kullanma yetkiniz yok.'
    );
  }

  try {
    if (msg.text && !msg.text.startsWith('/')) {
      await createAndPublishPost(msg, {
        type: 'text',
        text: msg.text,
        fileId: null
      });
    }
    else if (msg.photo) {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      await createAndPublishPost(msg, {
        type: 'photo',
        text: msg.caption || '',
        fileId: photoId
      });
    }
    else if (msg.video) {
      const videoId = msg.video.file_id;
      await createAndPublishPost(msg, {
        type: 'video',
        text: msg.caption || '',
        fileId: videoId
      });
    }

  } catch (error) {
    console.error('Message handler error:', error);
    await bot.sendMessage(msg.chat.id, 
      `❌ Bir hata oluştu: ${error.message}`
    );
  }
});

// Komutlar
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return bot.sendMessage(msg.chat.id, 
      '⛔ Bu botu kullanma yetkiniz yok.'
    );
  }

  await bot.sendMessage(msg.chat.id, 
    '🎯 *CNBR Tahmin Botu*\n\n' +
    'Bu bot ile tahmin etkinlikleri oluşturabilirsiniz.\n\n' +
    '*Kullanım:*\n' +
    '📝 Metin, fotoğraf veya video gönderin\n' +
    '⏰ Mesajda tarih belirtin: "15.03 20:30"\n' +
    '⚽ Takım isimleri: "Galatasaray - Fenerbahçe"\n\n' +
    '*Komutlar:*\n' +
    '/help - Yardım\n' +
    '/stats - İstatistikler\n' +
    '/backup - Yedek al',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  await bot.sendMessage(msg.chat.id,
    '📖 *Yardım*\n\n' +
    '*Etkinlik Oluşturma:*\n' +
    '1. Bota mesaj, fotoğraf veya video gönderin\n' +
    '2. Otomatik olarak belirlenen kanallara paylaşılır\n' +
    '3. Widget URL\'i alırsınız\n' +
    '4. Admin panelden düzenleyebilirsiniz\n\n' +
    '*Otomatik Deadline:*\n' +
    'Mesajınızda "15.03 20:30" formatında tarih belirtin\n\n' +
    '*Otomatik Takımlar:*\n' +
    'Mesajınızda "Galatasaray - Fenerbahçe" yazın\n\n' +
    '*Widget URL:*\n' +
    `${BASE_URL}/widget/POST_ID\n\n` +
    '*Admin Panel:*\n' +
    `${BASE_URL}/admin/result/POST_ID`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/stats/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  try {
    const posts = PostManager.getAll();
    const { PredictionManager } = require('./data-manager');
    const predictions = PredictionManager.getAll();
    
    const totalPosts = Object.keys(posts).length;
    const totalPredictions = Object.values(predictions).reduce((sum, arr) => sum + arr.length, 0);
    const activePosts = PostManager.getActive().length;

    await bot.sendMessage(msg.chat.id,
      '📊 *İstatistikler*\n\n' +
      `📝 Toplam Etkinlik: ${totalPosts}\n` +
      `⚽ Toplam Tahmin: ${totalPredictions}\n` +
      `🔴 Aktif Etkinlik: ${activePosts}\n` +
      `💾 Depolama: JSON dosyaları`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Stats error:', error);
    await bot.sendMessage(msg.chat.id, '❌ İstatistikler alınamadı');
  }
});

bot.onText(/\/backup/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  try {
    const { BackupManager } = require('./data-manager');
    const backupPath = BackupManager.create();
    
    await bot.sendMessage(msg.chat.id,
      `✅ Yedek oluşturuldu!\n\n📁 ${backupPath}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Backup error:', error);
    await bot.sendMessage(msg.chat.id, '❌ Yedek oluşturulamadı');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Bot stopping...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Bot stopping...');
  bot.stopPolling();
  process.exit(0);
});

module.exports = bot;
