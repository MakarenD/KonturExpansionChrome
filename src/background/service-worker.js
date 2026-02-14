/**
 * Service Worker (background script) — обрабатывает запросы от content script.
 *
 * Задачи:
 *  - Принимает сообщения от content script
 *  - Отправляет email с PDF через backend API (с API-ключом)
 *  - Управляет настройками (backendUrl, apiKey)
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

// ─── Отправка счёта на email через backend API ─────────────────

/**
 * Отправляет PDF-счёт на email гостя через серверный API.
 *
 * @param {Object} data
 * @param {string} data.to — email получателя
 * @param {string} data.guestName — имя гостя
 * @param {string} data.bookingNumber — номер бронирования
 * @param {string} data.pdfBase64 — PDF-файл в формате base64
 * @param {string} data.pdfFilename — имя файла PDF
 * @returns {Promise<Object>}
 */
async function handleSendInvoice(data) {
  // Получаем настройки из хранилища
  var settings = await getSettings();

  if (!settings.backendUrl) {
    throw new Error('Не указан URL backend-сервера. Откройте настройки расширения.');
  }

  if (!settings.apiKey) {
    throw new Error('Не указан API-ключ. Откройте настройки расширения.');
  }

  // Формируем тело письма
  var emailSubject = 'Счёт на предоплату — бронирование №' + data.bookingNumber;
  var emailBody =
    'Добрый день, ' + data.guestName + '!\n\n' +
    'Направляем вам счёт на предоплату по бронированию №' + data.bookingNumber + '.\n' +
    'Счёт находится в приложении к данному письму.\n\n' +
    'С уважением,\n' +
    'Служба бронирования';

  // Отправляем запрос на backend (без SMTP-данных — они на сервере)
  var response = await fetch(settings.backendUrl + '/api/send-invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': settings.apiKey
    },
    body: JSON.stringify({
      to: data.to,
      subject: emailSubject,
      text: emailBody,
      pdfBase64: data.pdfBase64,
      pdfFilename: data.pdfFilename
    })
  });

  if (!response.ok) {
    var errorText = await response.text();
    throw new Error('Сервер вернул ошибку: ' + response.status + ' — ' + errorText);
  }

  return await response.json();
}

// ─── Вспомогательные функции ───────────────────────────────────

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
