const fs = require('fs');
const path = require('path');

// Data dosya yolları
const DATA_DIR = path.join(__dirname, 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const USER_STATS_FILE = path.join(DATA_DIR, 'user-stats.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Lock mekanizması için
const locks = {};

// Data klasörünü oluştur
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Dosyaları initialize et
function initializeFiles() {
  const files = [
    { path: POSTS_FILE, default: {} },
    { path: PREDICTIONS_FILE, default: {} },
    { path: RESULTS_FILE, default: {} },
    { path: USER_STATS_FILE, default: {} },
    { path: SESSIONS_FILE, default: {} }
  ];

  files.forEach(file => {
    if (!fs.existsSync(file.path)) {
      fs.writeFileSync(file.path, JSON.stringify(file.default, null, 2));
      console.log(`✅ Created: ${path.basename(file.path)}`);
    }
  });

  console.log('✅ Data files initialized');
}

// Güvenli dosya okuma
function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return {};
  }
}

// Güvenli dosya yazma
function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error.message);
    return false;
  }
}

// Async lock mekanizması
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

// ============================================
// POST OPERATIONS
// ============================================

const PostManager = {
  getAll: () => {
    return readJSON(POSTS_FILE);
  },

  getById: (id) => {
    const posts = readJSON(POSTS_FILE);
    return posts[id] || null;
  },

  create: async (postData) => {
    return await withLock('posts', () => {
      const posts = readJSON(POSTS_FILE);
      posts[postData.id] = {
        ...postData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      writeJSON(POSTS_FILE, posts);
      return postData.id;
    });
  },

  update: async (id, updates) => {
    return await withLock('posts', () => {
      const posts = readJSON(POSTS_FILE);
      if (!posts[id]) return false;
      
      posts[id] = {
        ...posts[id],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      
      return writeJSON(POSTS_FILE, posts);
    });
  },

  delete: async (id) => {
    return await withLock('posts', () => {
      const posts = readJSON(POSTS_FILE);
      delete posts[id];
      return writeJSON(POSTS_FILE, posts);
    });
  },

  getActive: () => {
    const posts = readJSON(POSTS_FILE);
    const now = new Date();
    
    return Object.entries(posts)
      .filter(([_, post]) => {
        if (!post.deadline) return true;
        return new Date(post.deadline) > now;
      })
      .map(([id, post]) => ({ id, ...post }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  getAllSorted: (limit = 50) => {
    const posts = readJSON(POSTS_FILE);
    
    return Object.entries(posts)
      .map(([id, post]) => ({ id, ...post }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
};

// ============================================
// PREDICTION OPERATIONS
// ============================================

const PredictionManager = {
  getAll: () => {
    return readJSON(PREDICTIONS_FILE);
  },

  getByPostId: (postId, includeHidden = false) => {
    const predictions = readJSON(PREDICTIONS_FILE);
    const postPredictions = predictions[postId] || [];
    
    if (includeHidden) {
      return postPredictions;
    }
    
    return postPredictions.filter(p => !p.isHidden);
  },

  create: async (postId, predictionData) => {
    return await withLock('predictions', () => {
      const predictions = readJSON(PREDICTIONS_FILE);
      
      if (!predictions[postId]) {
        predictions[postId] = [];
      }

      const newPrediction = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        ...predictionData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      predictions[postId].unshift(newPrediction);
      
      writeJSON(PREDICTIONS_FILE, predictions);
      return newPrediction.id;
    });
  },

  checkDuplicate: (postId, telegramId, userToken) => {
    const predictions = readJSON(PREDICTIONS_FILE);
    const postPredictions = predictions[postId] || [];

    return postPredictions.some(p => {
      if (telegramId && p.telegramId === telegramId) return true;
      if (userToken && p.userToken === userToken) return true;
      return false;
    });
  },

  getCount: (postId) => {
    const predictions = readJSON(PREDICTIONS_FILE);
    return (predictions[postId] || []).length;
  },

  getStats: (postId) => {
    const predictions = readJSON(PREDICTIONS_FILE);
    const postPredictions = (predictions[postId] || []).filter(p => !p.isHidden);

    if (postPredictions.length === 0) {
      return {
        total: 0,
        avgHome: 0,
        avgAway: 0,
        minHome: 0,
        maxHome: 0,
        minAway: 0,
        maxAway: 0
      };
    }

    const homeScores = postPredictions.map(p => p.homeScore);
    const awayScores = postPredictions.map(p => p.awayScore);

    return {
      total: postPredictions.length,
      avgHome: homeScores.reduce((a, b) => a + b, 0) / homeScores.length,
      avgAway: awayScores.reduce((a, b) => a + b, 0) / awayScores.length,
      minHome: Math.min(...homeScores),
      maxHome: Math.max(...homeScores),
      minAway: Math.min(...awayScores),
      maxAway: Math.max(...awayScores)
    };
  },

  getPopularScores: (postId, limit = 5) => {
    const predictions = readJSON(PREDICTIONS_FILE);
    const postPredictions = (predictions[postId] || []).filter(p => !p.isHidden);

    const scoreCounts = {};

    postPredictions.forEach(p => {
      const key = `${p.homeScore}-${p.awayScore}`;
      scoreCounts[key] = (scoreCounts[key] || 0) + 1;
    });

    return Object.entries(scoreCounts)
      .map(([score, count]) => {
        const [home, away] = score.split('-').map(Number);
        return { homeScore: home, awayScore: away, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },

  getByUser: (telegramId) => {
    const predictions = readJSON(PREDICTIONS_FILE);
    const userPredictions = [];

    Object.entries(predictions).forEach(([postId, preds]) => {
      preds.forEach(p => {
        if (p.telegramId === telegramId) {
          userPredictions.push({ postId, ...p });
        }
      });
    });

    return userPredictions.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
  }
};

// ============================================
// RESULT OPERATIONS
// ============================================

const ResultManager = {
  getAll: () => {
    return readJSON(RESULTS_FILE);
  },

  getByPostId: (postId) => {
    const results = readJSON(RESULTS_FILE);
    return results[postId] || null;
  },

  create: async (postId, homeScore, awayScore) => {
    return await withLock('results', () => {
      const results = readJSON(RESULTS_FILE);
      
      results[postId] = {
        homeScore,
        awayScore,
        announcedAt: new Date().toISOString()
      };

      return writeJSON(RESULTS_FILE, results);
    });
  },

  getWinners: (postId) => {
    const results = readJSON(RESULTS_FILE);
    const result = results[postId];
    
    if (!result) return [];

    const predictions = readJSON(PREDICTIONS_FILE);
    const postPredictions = predictions[postId] || [];

    return postPredictions.filter(p => 
      p.homeScore === result.homeScore && 
      p.awayScore === result.awayScore
    ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
};

// ============================================
// USER STATS OPERATIONS
// ============================================

const UserStatsManager = {
  getAll: () => {
    return readJSON(USER_STATS_FILE);
  },

  getByTelegramId: (telegramId) => {
    const stats = readJSON(USER_STATS_FILE);
    return stats[telegramId] || null;
  },

  upsert: async (telegramId, username, rumuz) => {
    return await withLock('user-stats', () => {
      const stats = readJSON(USER_STATS_FILE);
      
      if (!stats[telegramId]) {
        stats[telegramId] = {
          telegramId,
          username,
          rumuz,
          totalPoints: 0,
          correctPredictions: 0,
          totalPredictions: 0,
          accuracy: 0,
          streak: 0,
          bestStreak: 0,
          lastPredictionDate: null,
          lastCorrectDate: null,
          updatedAt: new Date().toISOString()
        };
      }

      stats[telegramId].username = username;
      stats[telegramId].rumuz = rumuz;
      stats[telegramId].totalPredictions += 1;
      stats[telegramId].lastPredictionDate = new Date().toISOString();
      stats[telegramId].updatedAt = new Date().toISOString();

      return writeJSON(USER_STATS_FILE, stats);
    });
  },

  updateCorrect: async (telegramId) => {
    return await withLock('user-stats', () => {
      const stats = readJSON(USER_STATS_FILE);
      
      if (!stats[telegramId]) return false;

      const user = stats[telegramId];
      
      user.correctPredictions += 1;
      user.totalPoints += 10;
      user.accuracy = (user.correctPredictions / user.totalPredictions) * 100;

      // Streak hesapla
      const today = new Date().toISOString().split('T')[0];
      const lastCorrect = user.lastCorrectDate 
        ? new Date(user.lastCorrectDate).toISOString().split('T')[0]
        : null;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (lastCorrect === yesterdayStr) {
        user.streak += 1;
      } else if (lastCorrect !== today) {
        user.streak = 1;
      }

      user.bestStreak = Math.max(user.bestStreak, user.streak);
      user.lastCorrectDate = new Date().toISOString();
      user.updatedAt = new Date().toISOString();

      return writeJSON(USER_STATS_FILE, stats);
    });
  },

  getLeaderboard: (limit = 100) => {
    const stats = readJSON(USER_STATS_FILE);
    
    return Object.values(stats)
      .sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) {
          return b.totalPoints - a.totalPoints;
        }
        return b.accuracy - a.accuracy;
      })
      .slice(0, limit);
  }
};

// ============================================
// SESSION OPERATIONS
// ============================================

const SessionManager = {
  create: async (token, telegramId, username, expiresInDays = 30) => {
    return await withLock('sessions', () => {
      const sessions = readJSON(SESSIONS_FILE);
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      sessions[token] = {
        token,
        telegramId,
        username,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastUsed: new Date().toISOString()
      };

      return writeJSON(SESSIONS_FILE, sessions);
    });
  },

  validate: async (token) => {
    const sessions = readJSON(SESSIONS_FILE);
    const session = sessions[token];

    if (!session) return null;

    const now = new Date();
    const expiresAt = new Date(session.expiresAt);

    if (expiresAt < now) {
      // Expired session
      await SessionManager.delete(token);
      return null;
    }

    // Update last used
    await withLock('sessions', () => {
      const sessions = readJSON(SESSIONS_FILE);
      if (sessions[token]) {
        sessions[token].lastUsed = new Date().toISOString();
        writeJSON(SESSIONS_FILE, sessions);
      }
    });

    return session;
  },

  delete: async (token) => {
    return await withLock('sessions', () => {
      const sessions = readJSON(SESSIONS_FILE);
      delete sessions[token];
      return writeJSON(SESSIONS_FILE, sessions);
    });
  },

  cleanup: async () => {
    return await withLock('sessions', () => {
      const sessions = readJSON(SESSIONS_FILE);
      const now = new Date();
      let cleaned = 0;

      Object.keys(sessions).forEach(token => {
        const expiresAt = new Date(sessions[token].expiresAt);
        if (expiresAt < now) {
          delete sessions[token];
          cleaned++;
        }
      });

      writeJSON(SESSIONS_FILE, sessions);
      return cleaned;
    });
  }
};

// ============================================
// BACKUP OPERATIONS
// ============================================

const BackupManager = {
  create: () => {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupDir = path.join(__dirname, 'backups', timestamp);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const files = [
      POSTS_FILE,
      PREDICTIONS_FILE,
      RESULTS_FILE,
      USER_STATS_FILE,
      SESSIONS_FILE
    ];

    files.forEach(file => {
      const fileName = path.basename(file);
      const backupPath = path.join(backupDir, fileName);
      fs.copyFileSync(file, backupPath);
    });

    console.log(`✅ Backup created: ${backupDir}`);
    return backupDir;
  },

  restore: (backupPath) => {
    const files = fs.readdirSync(backupPath);

    files.forEach(file => {
      const sourcePath = path.join(backupPath, file);
      const destPath = path.join(DATA_DIR, file);
      fs.copyFileSync(sourcePath, destPath);
    });

    console.log(`✅ Restored from: ${backupPath}`);
  },

  cleanOld: (daysToKeep = 7) => {
    const backupsDir = path.join(__dirname, 'backups');
    
    if (!fs.existsSync(backupsDir)) return 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const backups = fs.readdirSync(backupsDir);
    let deleted = 0;

    backups.forEach(backup => {
      const backupPath = path.join(backupsDir, backup);
      const stats = fs.statSync(backupPath);

      if (stats.mtime < cutoffDate) {
        fs.rmSync(backupPath, { recursive: true, force: true });
        deleted++;
      }
    });

    console.log(`✅ Deleted ${deleted} old backups`);
    return deleted;
  }
};

// Initialize on module load
initializeFiles();

module.exports = {
  PostManager,
  PredictionManager,
  ResultManager,
  UserStatsManager,
  SessionManager,
  BackupManager,
  initializeFiles
};
