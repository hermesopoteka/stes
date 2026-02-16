/**
 * İframe Communication Library
 * Parent ve Child window arasında güvenli mesajlaşma
 */

(function() {
  'use strict';

  // İzin verilen parent domain'ler
  const ALLOWED_ORIGINS = (window.ALLOWED_ORIGINS || []).concat([
    'http://localhost',
    'https://localhost'
  ]);

  /**
   * Parent'a mesaj gönder
   */
  function sendToParent(type, data) {
    if (!window.parent || window.parent === window) {
      return; // iframe içinde değilse
    }

    const message = {
      type: `cnbr_${type}`,
      data: data,
      timestamp: Date.now()
    };

    // Tüm izinli origin'lere gönder
    ALLOWED_ORIGINS.forEach(origin => {
      try {
        window.parent.postMessage(message, origin);
      } catch (err) {
        console.error('Failed to send message to parent:', err);
      }
    });

    // Wildcard için
    if (ALLOWED_ORIGINS.includes('*')) {
      window.parent.postMessage(message, '*');
    }
  }

  /**
   * Parent'tan mesaj al
   */
  function receiveFromParent(callback) {
    window.addEventListener('message', function(event) {
      // Origin kontrolü
      const isAllowed = ALLOWED_ORIGINS.includes('*') || 
                       ALLOWED_ORIGINS.some(origin => event.origin.startsWith(origin));

      if (!isAllowed) {
        console.warn('Message from unauthorized origin:', event.origin);
        return;
      }

      // Mesaj validasyonu
      if (!event.data || typeof event.data !== 'object') {
        return;
      }

      // CNBR mesajı mı kontrol et
      if (event.data.type && event.data.type.startsWith('cnbr_')) {
        const type = event.data.type.replace('cnbr_', '');
        callback(type, event.data.data, event);
      }
    });
  }

  /**
   * İframe yüksekliğini parent'a bildir
   */
  function reportHeight() {
    const height = document.body.scrollHeight;
    sendToParent('resize', { height });
  }

  /**
   * Auto-resize: İçerik değiştiğinde yüksekliği güncelle
   */
  function enableAutoResize(interval = 500) {
    let lastHeight = 0;

    setInterval(() => {
      const currentHeight = document.body.scrollHeight;
      
      if (currentHeight !== lastHeight) {
        lastHeight = currentHeight;
        reportHeight();
      }
    }, interval);

    // MutationObserver ile daha akıllı resize
    if (window.MutationObserver) {
      const observer = new MutationObserver(() => {
        const currentHeight = document.body.scrollHeight;
        if (currentHeight !== lastHeight) {
          lastHeight = currentHeight;
          reportHeight();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });
    }

    // İlk yükleme
    setTimeout(reportHeight, 100);
    window.addEventListener('load', reportHeight);
  }

  /**
   * Scroll pozisyonunu parent'a bildir
   */
  function reportScroll() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    sendToParent('scroll', { scrollTop });
  }

  /**
   * Analytics event'lerini parent'a bildir
   */
  function trackEvent(eventName, eventData) {
    sendToParent('analytics', {
      event: eventName,
      data: eventData,
      url: window.location.href,
      timestamp: Date.now()
    });
  }

  /**
   * Error reporting
   */
  function reportError(error) {
    sendToParent('error', {
      message: error.message,
      stack: error.stack,
      url: window.location.href
    });
  }

  /**
   * İframe tam yüklendiğini bildir
   */
  function reportReady() {
    sendToParent('ready', {
      url: window.location.href,
      title: document.title
    });
  }

  /**
   * Tahmin gönderildiğinde bildir
   */
  function reportPredictionSubmitted(predictionData) {
    sendToParent('prediction_submitted', predictionData);
    trackEvent('prediction_submit', predictionData);
  }

  /**
   * Form hatası bildir
   */
  function reportFormError(errorMessage) {
    sendToParent('form_error', { error: errorMessage });
  }

  /**
   * Global hata yakalama
   */
  window.addEventListener('error', function(event) {
    reportError(event.error || new Error(event.message));
  });

  window.addEventListener('unhandledrejection', function(event) {
    reportError(new Error(event.reason));
  });

  // Public API
  window.IframeComm = {
    send: sendToParent,
    receive: receiveFromParent,
    reportHeight: reportHeight,
    enableAutoResize: enableAutoResize,
    reportScroll: reportScroll,
    trackEvent: trackEvent,
    reportError: reportError,
    reportReady: reportReady,
    reportPredictionSubmitted: reportPredictionSubmitted,
    reportFormError: reportFormError
  };

  // Auto-initialize
  if (window.self !== window.top) {
    // iframe içinde çalışıyoruz
    enableAutoResize();
    
    document.addEventListener('DOMContentLoaded', function() {
      reportReady();
    });
  }

})();
