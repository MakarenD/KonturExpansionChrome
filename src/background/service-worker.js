/**
 * Service Worker (background script) — обрабатывает запросы от content script.
 *
 * Задачи:
 *  - Принимает сообщения от content script
 *  - Отправляет email с PDF через backend API (с API-ключом)
 *  - Управляет настройками (backendUrl, apiKey)
 *
 * PDF отправляется как бинарный файл через FormData (multipart/form-data),
 * что на ~33% меньше по размеру, чем base64 в JSON.
 *
 * SMTP-данные хранятся на сервере (Vercel env vars), не в расширении.
 */

// ─── Обработчик сообщений от content script ────────────────────

// ─── Проверка обновлений ───────────────────────────────────────

const GITHUB_REPO_OWNER = 'MakarenD';  // GitHub username
const GITHUB_REPO_NAME = 'KonturExpansionChrome';
const UPDATE_CHECK_INTERVAL = 1 * 60 * 1000; // 1 минута

/**
 * Проверяет наличие новой версии на GitHub Releases.
 * @returns {Promise<{available: boolean, release?: Object, localVersion?: string}>}
 */
async function checkForUpdates() {
  try {
    // Получаем локальную версию из manifest.json через chrome.runtime
    var localVersion = chrome.runtime.getManifest().version;
    
    // Запрашиваем последний релиз с GitHub API
    var response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
      { headers: { 'Accept': 'application/vnd.github.v3+json' } }
    );
    
    if (!response.ok) {
      console.error('[KonturUpdate] Ошибка GitHub API:', response.status);
      return { available: false, localVersion: localVersion };
    }
    
    var release = await response.json();
    var remoteVersion = release.tag_name.replace(/^v/, '');
    
    // Сравниваем версии
    if (compareVersions(localVersion, remoteVersion) < 0) {
      console.log('[KonturUpdate] Доступна новая версия:', remoteVersion);
      return {
        available: true,
        localVersion: localVersion,
        release: {
          version: remoteVersion,
          tagName: release.tag_name,
          name: release.name,
          publishedAt: release.published_at,
          body: release.body,
          zipUrl: release.zipball_url
        }
      };
    }
    
    return { available: false, localVersion: localVersion };
  }
  catch (error) {
    console.error('[KonturUpdate] Ошибка проверки обновлений:', error);
    return { available: false, error: error.message };
  }
}

/**
 * Сравнивает две семантические версии.
 * @param {string} v1 - Первая версия
 * @param {string} v2 - Вторая версия
 * @returns {number} -1 если v1 < v2, 0 если равны, 1 если v1 > v2
 */
function compareVersions(v1, v2) {
  var parts1 = v1.split('.').map(Number);
  var parts2 = v2.split('.').map(Number);
  var len = Math.max(parts1.length, parts2.length);
  
  for (var i = 0; i < len; i++) {
    var n1 = parts1[i] || 0;
    var n2 = parts2[i] || 0;
    
    if (n1 < n2) return -1;
    if (n1 > n2) return 1;
  }
  return 0;
}

/** Запускает периодическую проверку обновлений. */
function startUpdateChecker() {
  console.log('[KonturUpdate] Проверка обновлений запущена (интервал: 1 минута)');
  
  // Проверяем сразу при старте service worker
  checkForUpdates().then(function (result) {
    console.log('[KonturUpdate] Результат проверки:', result);
    if (result.available) {
      console.log('[KonturUpdate] Доступна новая версия:', result.release.version);
      sendMessageToAllTabs(result);
    }
  });
  
  // Планируем повторную проверку через интервал
  setInterval(function () {
    console.log('[KonturUpdate] Плановая проверка обновлений...');
    checkForUpdates().then(function (result) {
      if (result.available) {
        sendMessageToAllTabs(result);
      }
    });
  }, UPDATE_CHECK_INTERVAL);
}

/**
 * Отправляет сообщение всем вкладкам с hotel.kontur.ru
 * с повторными попытками если content script ещё не готов
 */
function sendMessageToAllTabs(result) {
  chrome.tabs.query({ url: 'https://hotel.kontur.ru/*' }, function (tabs) {
    console.log('[KonturUpdate] Найдено вкладок hotel.kontur.ru:', tabs.length);
    
    if (tabs.length === 0) {
      console.log('[KonturUpdate] Нет открытых вкладок hotel.kontur.ru - пропускаем уведомление');
      return;
    }
    
    tabs.forEach(function (tab) {
      console.log('[KonturUpdate] Отправка сообщения на вкладку', tab.id, '...');
      
      // Первая попытка
      sendWithRetry(tab.id, result, 0);
    });
  });
}

/**
 * Отправляет сообщение с повторными попытками (0мс, 500мс, 1000мс)
 */
function sendWithRetry(tabId, result, attempt) {
  if (attempt > 2) {
    console.log('[KonturUpdate] Превышено число попыток для вкладки', tabId);
    return;
  }
  
  var delay = attempt * 500;
  
  setTimeout(function () {
    chrome.tabs.sendMessage(tabId, {
      action: 'UPDATE_AVAILABLE',
      data: result
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.log('[KonturUpdate] Попытка', attempt + 1, 'неудачна:', chrome.runtime.lastError.message);
        // Повторная попытка
        sendWithRetry(tabId, result, attempt + 1);
      } else {
        console.log('[KonturUpdate] Успешно отправлено на вкладку', tabId, '(попытка', attempt + 1, ')');
      }
    });
  }, delay);
}

// Запускаем проверку обновлений при старте service worker
startUpdateChecker();

// ─── Обработчик сообщений от content script ────────────────────

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === 'SEND_INVOICE_EMAIL') {
    handleSendInvoice(message.data)
      .then(function (result) {
        sendResponse({ success: true, data: result });
      })
      .catch(function (error) {
        sendResponse({ success: false, error: error.message });
      });

    // Возвращаем true чтобы sendResponse работал асинхронно
    return true;
  }

  if (message.action === 'GET_SETTINGS') {
    chrome.storage.local.get(['backendUrl', 'apiKey'], function (data) {
      sendResponse({ success: true, data: data });
    });
    return true;
  }
  
  if (message.action === 'CHECK_UPDATES') {
    checkForUpdates()
      .then(function (result) {
        sendResponse({ success: true, data: result });
      })
      .catch(function (error) {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

// ─── Вспомогательные функции ───────────────────────────────────

/**
 * Декодирует base64-строку в бинарный Uint8Array.
 * Используется для конвертации PDF из base64 в бинарный Blob перед отправкой.
 */
function base64ToUint8Array(base64) {
  var binaryString = atob(base64);
  var bytes = new Uint8Array(binaryString.length);
  for (var i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** Читает настройки из chrome.storage.local. */
function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(
      ['backendUrl', 'apiKey'],
      function (data) {
        resolve(data);
      }
    );
  });
}

// ─── Отправка счёта на email через backend API ─────────────────

/**
 * Отправляет PDF-счёт на email гостя через серверный API.
 *
 * PDF отправляется как бинарный файл в FormData (multipart/form-data),
 * что позволяет избежать overhead base64-кодирования (~33%) и
 * укладываться в лимиты payload Vercel serverless functions.
 *
 * @param {Object} data
 * @param {string} data.to — email получателя
 * @param {string} data.guestName — имя гостя
 * @param {string} data.bookingNumber — номер бронирования
 * @param {string} data.pdfBase64 — PDF-файл в формате base64
 * @param {string} data.pdfFilename — имя файла PDF
 * @param {string} [data.emailSubject] — тема письма (опционально)
 * @param {string} [data.emailBody] — тело письма (опционально)
 * @returns {Promise<Object>}
 */
async function handleSendInvoice(data) {
  var settings = await getSettings();

  if (!settings.backendUrl) {
    throw new Error('Не указан URL backend-сервера. Откройте настройки расширения.');
  }

  if (!settings.apiKey) {
    throw new Error('Не указан API-ключ. Откройте настройки расширения.');
  }

  var emailSubject = data.emailSubject ||
    ('Счёт на предоплату — бронирование №' + data.bookingNumber);
  var emailBody = data.emailBody ||
    ('Здравствуйте!\n\n' +
    'К письму прилагается документ по бронированию №' + data.bookingNumber + '.\n\n' +
    'Спасибо, что выбрали нас, «Альбатрос» ждёт Вас!\n' +
    '__\n' +
    'С уважением, отдел бронирования ГРК «Альбатрос»\n' +
    'Официальный сайт: https://albatrosmore.ru/\n' +
    ' 8 (800) 101-47-17\n' +
    ' 8 (861) 213-21-17\n\n' +
    'Альбатрос — место, куда возвращаются за счастьем');

  // Декодируем PDF из base64 в бинарный Blob
  var pdfBytes = base64ToUint8Array(data.pdfBase64);
  var pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });

  console.log('[KonturPrepay] Размер PDF: ' + Math.round(pdfBytes.length / 1024) + ' КБ (бинарный)');

  // Формируем FormData с метаданными и бинарным PDF
  var formData = new FormData();
  formData.append('to', data.to);
  formData.append('subject', emailSubject);
  formData.append('text', emailBody);
  formData.append('pdfFilename', data.pdfFilename);
  formData.append('pdf', pdfBlob, data.pdfFilename);

  // Отправляем multipart/form-data запрос (без Content-Type — браузер установит сам с boundary)
  var response = await fetch(settings.backendUrl + '/api/send-invoice', {
    method: 'POST',
    headers: {
      'X-API-Key': settings.apiKey
    },
    body: formData
  });

  if (!response.ok) {
    var errorText = await response.text();
    throw new Error('Сервер вернул ошибку: ' + response.status + ' — ' + errorText);
  }

  return await response.json();
}
