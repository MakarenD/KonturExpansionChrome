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
 * Тело запроса: multipart/form-data
 *   Поля:
 *     to          — email получателя
 *     subject     — тема письма
 *     text        — текст письма
 *     pdfFilename — имя файла PDF
 *   Файл:
 *     pdf         — PDF-файл (бинарный)
 *
 * Также поддерживается legacy-формат JSON (для обратной совместимости):
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
var Busboy = require('busboy');

// ─── Парсинг multipart/form-data ────────────────────────────────

/**
 * Парсит multipart/form-data запрос с помощью busboy.
 * Возвращает { fields: { key: value }, pdfBuffer: Buffer }.
 */
function parseMultipart(req) {
  return new Promise(function (resolve, reject) {
    var fields = {};
    var pdfBuffer = null;

    var busboy = Busboy({ headers: req.headers });

    busboy.on('field', function (fieldname, val) {
      fields[fieldname] = val;
    });

    busboy.on('file', function (fieldname, file) {
      if (fieldname === 'pdf') {
        var chunks = [];
        file.on('data', function (chunk) {
          chunks.push(chunk);
        });
        file.on('end', function () {
          pdfBuffer = Buffer.concat(chunks);
        });
      } else {
        file.resume();
      }
    });

    busboy.on('finish', function () {
      resolve({ fields: fields, pdfBuffer: pdfBuffer });
    });

    busboy.on('error', function (err) {
      reject(err);
    });

    req.pipe(busboy);
  });
}

// ─── Парсинг raw JSON (fallback для обратной совместимости) ──────

/**
 * Читает raw body из req stream и парсит как JSON.
 * Используется когда bodyParser отключён, но запрос приходит как JSON.
 */
function parseRawJson(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (chunk) {
      chunks.push(chunk);
    });
    req.on('end', function () {
      try {
        var raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Не удалось разобрать JSON: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

// ─── Основной обработчик ─────────────────────────────────────────

async function handler(req, res) {
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

    // ─── Разбор тела запроса (multipart или JSON) ────────────

    var to, subject, text, pdfFilename, pdfBuffer;
    var contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      // Новый формат: multipart/form-data с бинарным PDF
      var parsed = await parseMultipart(req);
      to = parsed.fields.to;
      subject = parsed.fields.subject;
      text = parsed.fields.text;
      pdfFilename = parsed.fields.pdfFilename;
      pdfBuffer = parsed.pdfBuffer;

      console.log('[SendInvoice] Получен multipart-запрос, PDF размер:',
        pdfBuffer ? pdfBuffer.length + ' байт' : 'отсутствует');
    } else {
      // Legacy формат: JSON с base64-кодированным PDF
      var body = req.body || await parseRawJson(req);
      to = body.to;
      subject = body.subject;
      text = body.text;
      pdfFilename = body.pdfFilename;

      if (body.pdfBase64) {
        pdfBuffer = Buffer.from(body.pdfBase64, 'base64');
      }

      console.log('[SendInvoice] Получен JSON-запрос, PDF размер:',
        pdfBuffer ? pdfBuffer.length + ' байт' : 'отсутствует');
    }

    // ─── Валидация полей ─────────────────────────────────────

    var missingFields = [];
    if (!to) missingFields.push('to');
    if (!subject) missingFields.push('subject');
    if (!text) missingFields.push('text');
    if (!pdfFilename) missingFields.push('pdfFilename');
    if (!pdfBuffer || pdfBuffer.length === 0) missingFields.push('pdf');

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: ' + missingFields.join(', ')
      });
    }

    // Валидация email
    if (!/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(to)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный email получателя: ' + to
      });
    }

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
        name: 'ГРК Альбатрос',
        address: smtpEmail
      },
      to: to,
      subject: subject,
      text: text,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    var info = await transporter.sendMail(mailOptions);

    console.log('[SendInvoice] Email отправлен:', info.messageId, '→', to);

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
}

module.exports = handler;

// Отключаем стандартный bodyParser Vercel для поддержки multipart/form-data.
// Также увеличиваем лимит для JSON-запросов (legacy fallback).
module.exports.config = {
  api: {
    bodyParser: false
  }
};
