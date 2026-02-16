/**
 * Vercel Serverless Function — отправка счёта на предоплату через Yandex SMTP.
 *
 * После отправки письмо сохраняется в папку «Отправленные» через IMAP,
 * чтобы оно было видно в веб-интерфейсе Яндекс Почты.
 *
 * SMTP/IMAP-credentials и API-ключ берутся из переменных окружения Vercel:
 *   SMTP_EMAIL    — логин Яндекс Почты (hotel@yandex.ru)
 *   SMTP_PASSWORD — пароль приложения Яндекс
 *   API_KEY       — секретный ключ для авторизации запросов от расширения
 *
 * Endpoint: POST /api/send-invoice
 *
 * Заголовки:
 *   X-API-Key: <ваш API-ключ>
 *
 * Тело запроса (JSON):
 * {
 *   "to":          "guest@example.com",
 *   "subject":     "Счёт на предоплату",
 *   "text":        "Тело письма",
 *   "pdfBase64":   "JVBERi0xLjQ...",
 *   "pdfFilename": "Счёт.pdf"
 * }
 *
 * Ответ при успехе: { "success": true, "messageId": "..." }
 * Ответ при ошибке: { "success": false, "error": "описание ошибки" }
 */

var nodemailer = require('nodemailer');
var MailComposer = require('nodemailer/lib/mail-composer');
var { ImapFlow } = require('imapflow');

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    return res.status(200).end();
  }

  // Только POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // ─── Проверка API-ключа ──────────────────────────────────

    var serverApiKey = process.env.API_KEY;

    if (!serverApiKey) {
      console.error('[SendInvoice] Переменная окружения API_KEY не задана');
      return res.status(500).json({
        success: false,
        error: 'Сервер не настроен: отсутствует API_KEY'
      });
    }

    var clientApiKey = req.headers['x-api-key'] || '';

    if (clientApiKey !== serverApiKey) {
      return res.status(401).json({
        success: false,
        error: 'Неверный API-ключ. Проверьте настройки расширения.'
      });
    }

    // ─── Проверка SMTP-настроек ──────────────────────────────

    var smtpEmail = process.env.SMTP_EMAIL;
    var smtpPassword = process.env.SMTP_PASSWORD;

    if (!smtpEmail || !smtpPassword) {
      console.error('[SendInvoice] Переменные SMTP_EMAIL / SMTP_PASSWORD не заданы');
      return res.status(500).json({
        success: false,
        error: 'Сервер не настроен: отсутствуют SMTP-данные'
      });
    }

    // ─── Валидация тела запроса ──────────────────────────────

    var body = req.body;

    var requiredFields = ['to', 'subject', 'text', 'pdfBase64', 'pdfFilename'];
    var missingFields = [];
    for (var i = 0; i < requiredFields.length; i++) {
      if (!body[requiredFields[i]]) {
        missingFields.push(requiredFields[i]);
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: ' + missingFields.join(', ')
      });
    }

    // Валидация email
    if (!/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(body.to)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный email получателя: ' + body.to
      });
    }

    // Конвертируем PDF из base64 в Buffer
    var pdfBuffer = Buffer.from(body.pdfBase64, 'base64');

    // Проверяем что это похоже на PDF (начинается с %PDF)
    if (pdfBuffer.length < 4 || pdfBuffer.toString('utf8', 0, 4) !== '%PDF') {
      return res.status(400).json({
        success: false,
        error: 'Переданные данные не являются PDF-файлом'
      });
    }

    // ─── Отправка через Яндекс SMTP ─────────────────────────

    var transporter = nodemailer.createTransport({
      host: 'smtp.yandex.ru',
      port: 465,
      secure: true,
      auth: {
        user: smtpEmail,
        pass: smtpPassword
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000
    });

    var mailOptions = {
      from: {
        name: 'Служба бронирования',
        address: smtpEmail
      },
      to: body.to,
      subject: body.subject,
      text: body.text,
      attachments: [
        {
          filename: body.pdfFilename,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    var info = await transporter.sendMail(mailOptions);

    console.log('[SendInvoice] Email отправлен:', info.messageId, '→', body.to);

    // ─── Сохранение в «Отправленные» через IMAP ────────────
    // Best-effort: если IMAP-сохранение не удалось, письмо уже отправлено
    var imapSaved = false;

    try {
      var mail = new MailComposer(mailOptions);
      var rawMessage = await mail.compile().build();

      var imapClient = new ImapFlow({
        host: 'imap.yandex.ru',
        port: 993,
        secure: true,
        auth: {
          user: smtpEmail,
          pass: smtpPassword
        },
        logger: false
      });

      await imapClient.connect();

      // Определяем папку «Отправленные» по IMAP special-use атрибуту
      var sentFolder = 'Sent';
      try {
        var folders = await imapClient.list();
        for (var folder of folders) {
          if (folder.specialUse === '\\Sent') {
            sentFolder = folder.path;
            break;
          }
        }
      } catch (listErr) {
        console.warn('[SendInvoice] Не удалось получить список папок IMAP, используем "Sent":', listErr.message);
      }

      await imapClient.append(sentFolder, rawMessage, ['\\Seen']);
      await imapClient.logout();

      imapSaved = true;
      console.log('[SendInvoice] Письмо сохранено в папку "' + sentFolder + '" через IMAP');
    } catch (imapError) {
      console.error('[SendInvoice] Не удалось сохранить в "Отправленные" через IMAP:', imapError.message);
    }

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      imapSaved: imapSaved
    });

  } catch (error) {
    console.error('[SendInvoice] Ошибка:', error);

    var errorMessage = error.message || 'Неизвестная ошибка';

    if (error.code === 'EAUTH') {
      errorMessage = 'Ошибка авторизации SMTP. Проверьте настройки SMTP_EMAIL и SMTP_PASSWORD на сервере.';
    } else if (error.code === 'ESOCKET' || error.code === 'ECONNECTION') {
      errorMessage = 'Не удалось подключиться к Яндекс SMTP серверу.';
    } else if (error.code === 'EENVELOPE') {
      errorMessage = 'Некорректный адрес получателя.';
    }

    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
};
