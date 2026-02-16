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
