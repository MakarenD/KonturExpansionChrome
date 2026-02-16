/**
 * Модуль отправки email-счёта через backend API.
 *
 * Chrome-расширение не может работать с SMTP напрямую,
 * поэтому отправка происходит через serverless-функцию на Vercel.
 *
 * Поток:
 *  content.js → sendInvoiceEmail() → chrome.runtime.sendMessage →
 *  → service-worker.js → backend API → Yandex SMTP → email гостя
 */

/**
 * Отправляет счёт на email гостя через service worker и backend.
 *
 * @param {Object} emailData
 * @param {string} emailData.to — email получателя
 * @param {string} emailData.guestName — имя гостя (для темы письма)
 * @param {string} emailData.bookingNumber — номер бронирования
 * @param {string} emailData.pdfBase64 — PDF в формате base64
 * @param {string} emailData.pdfFilename — имя файла PDF
 * @param {Function} onSuccess — callback при успехе
 * @param {Function} onError — callback при ошибке (принимает строку с ошибкой)
 */
/**
 * Отправляет подтверждение бронирования на email гостя через service worker и backend.
 *
 * @param {Object} emailData
 * @param {string} emailData.to — email получателя
 * @param {string} emailData.guestName — имя гостя
 * @param {string} emailData.bookingNumber — номер бронирования
 * @param {string} emailData.pdfBase64 — PDF в формате base64
 * @param {string} emailData.pdfFilename — имя файла PDF
 * @param {Function} onSuccess — callback при успехе
 * @param {Function} onError — callback при ошибке
 */
function sendConfirmationEmail(emailData, onSuccess, onError) {
  if (!emailData.to || emailData.to.indexOf('@') === -1) {
    onError('Email гостя не указан или некорректен');
    return;
  }

  var subject = 'Подтверждение бронирования №' + emailData.bookingNumber;
  var body =
    'Здравствуйте!\n\n' +
    'Предоплата за ваш номер получена, ваше бронирование подтверждено.\n' +
    'Спасибо, что выбрали ГРК «Альбатрос»!\n' +
    'К письму прилагается подтверждение бронирования — ваучер.\n\n' +
    'При заезде при себе необходимо иметь паспорта граждан РФ на всех проживающих\n' +
    '(на детей — свидетельства о рождении), ваучер (во вложении) и квитанцию об оплате.\n\n' +
    'Мы будем очень рады видеть Вас!\n' +
    '__\n' +
    'С уважением, отдел бронирования ГРК «Альбатрос»\n' +
    'Официальный сайт: https://albatrosmore.ru/\n' +
    ' 8 (800) 101-47-17\n' +
    ' 8 (861) 213-21-17\n\n' +
    'Альбатрос — место, куда возвращаются за счастьем';

  chrome.runtime.sendMessage(
    {
      action: 'SEND_INVOICE_EMAIL',
      data: {
        to: emailData.to,
        guestName: emailData.guestName,
        bookingNumber: emailData.bookingNumber,
        pdfBase64: emailData.pdfBase64,
        pdfFilename: emailData.pdfFilename,
        emailSubject: subject,
        emailBody: body
      }
    },
    function (response) {
      if (chrome.runtime.lastError) {
        console.error('[KonturPrepay] Ошибка связи с service worker:', chrome.runtime.lastError);
        onError('Ошибка связи с расширением: ' + chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log('[KonturPrepay] Подтверждение успешно отправлено:', response.data);
        onSuccess();
      } else {
        var errorMsg = (response && response.error) || 'Неизвестная ошибка при отправке';
        console.error('[KonturPrepay] Ошибка отправки подтверждения:', errorMsg);
        onError(errorMsg);
      }
    }
  );
}

function sendInvoiceEmail(emailData, onSuccess, onError) {
  // Проверяем наличие email получателя
  if (!emailData.to || emailData.to.indexOf('@') === -1) {
    onError('Email гостя не указан или некорректен');
    return;
  }

  // Отправляем сообщение в service worker
  chrome.runtime.sendMessage(
    {
      action: 'SEND_INVOICE_EMAIL',
      data: emailData
    },
    function (response) {
      if (chrome.runtime.lastError) {
        console.error('[KonturPrepay] Ошибка связи с service worker:', chrome.runtime.lastError);
        onError('Ошибка связи с расширением: ' + chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log('[KonturPrepay] Email успешно отправлен:', response.data);
        onSuccess();
      } else {
        var errorMsg = (response && response.error) || 'Неизвестная ошибка при отправке email';
        console.error('[KonturPrepay] Ошибка отправки email:', errorMsg);
        onError(errorMsg);
      }
    }
  );
}
