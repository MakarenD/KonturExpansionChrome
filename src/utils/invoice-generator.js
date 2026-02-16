/**
 * Генератор PDF-счёта на предоплату.
 *
 * Использует jsPDF для формирования PDF-документа.
 * Шрифт Roboto (из roboto-regular.js) для поддержки кириллицы.
 *
 * Зависимости (загружены ранее):
 *  - jspdf.umd.min.js   → глобальная переменная jspdf
 *  - qrcode.js           → глобальная функция qrcode()
 *  - roboto-regular.js   → глобальная переменная ROBOTO_FONT_BASE64
 *  - stamp-signature.js  → STAMP_IMAGE_BASE64, SIGNATURE_IMAGE_BASE64
 *  - hotel-details.js    → глобальная переменная HOTEL_DETAILS
 */

/**
 * Генерирует PDF-счёт на предоплату.
 *
 * @param {Object} bookingData — данные бронирования (из parseBookingData)
 * @param {Object} hotelDetails — реквизиты отеля (HOTEL_DETAILS)
 * @returns {{ blob: Blob, base64: string, filename: string }}
 */
function generateInvoicePDF(bookingData, hotelDetails) {
  var jsPDF = jspdf.jsPDF;
  var doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  registerCyrillicFont(doc);

  var pageWidth = 210;
  var marginLeft = 14;
  var marginRight = 14;
  var contentWidth = pageWidth - marginLeft - marginRight;

  var invoiceNumber = generateInvoiceNumber(bookingData.bookingNumber);
  var invoiceDate = formatCurrentDate();

  var discountPercent = bookingData.discountPercent || 0;
  var fullPayment = bookingData.fullPaymentWithDiscount || bookingData.totalPrice;
  // Доплата считается от полной стоимости БЕЗ скидки
  var surchargeAtHotel = bookingData.totalPrice - bookingData.prepayAmount;
  if (surchargeAtHotel < 0) {
    surchargeAtHotel = 0;
  }

  var y = 20;

  // ─── Шапка: реквизиты отеля (как в ваучере) ───────────────

  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(hotelDetails.name, marginLeft, y);
  y += 5;

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text('Адрес отеля: ' + hotelDetails.address, marginLeft, y);
  y += 4;
  doc.text(
    'Тел.: ' + hotelDetails.phone + '    Email: ' + hotelDetails.email,
    marginLeft,
    y
  );
  y += 3;

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 12;

  // ─── Заголовок счёта ─────────────────────────────────────

  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('СЧЁТ НА ПРЕДОПЛАТУ', pageWidth / 2, y, { align: 'center' });
  y += 6;

  doc.setFontSize(10);
  doc.text(
    '№ ' + invoiceNumber + ' от ' + invoiceDate,
    pageWidth / 2,
    y,
    { align: 'center' }
  );
  y += 10;

  // ─── Информация о госте ──────────────────────────────────

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  y = drawLabelValue(doc, marginLeft, y, 'Гость:', bookingData.guestName);
  y = drawLabelValue(doc, marginLeft, y, 'Email:', bookingData.guestEmail);
  y = drawLabelValue(doc, marginLeft, y, 'Бронирование №:', bookingData.bookingNumber);
  if (bookingData.guestCount && bookingData.guestCount.total > 0) {
    y = drawLabelValue(doc, marginLeft, y, 'Количество гостей:', bookingData.guestCount.text || String(bookingData.guestCount.total));
  }
  y += 3;

  // ─── Таблица с деталями проживания ───────────────────────

  doc.setFontSize(8);
  var tableHeaders = ['Категория номера', 'Даты', 'Ночей', 'Цена/сут.', 'Сумма'];
  var cellPadding = 4;
  var datesStr = bookingData.checkIn + ' - ' + bookingData.checkOut;
  var roomLabelRaw = bookingData.roomType || 'Проживание';
  var nightsStr = String(bookingData.nightsCount);
  var rateStr = formatMoney(bookingData.nightlyRate);
  var totalStr = formatMoney(bookingData.totalPrice);

  var colWidths = calcTableColumnWidths(doc, contentWidth, tableHeaders, [
    roomLabelRaw,
    datesStr,
    nightsStr,
    rateStr,
    totalStr
  ], [25, 22, 12, 18, 22]);

  var roomLabel = truncateToWidth(doc, roomLabelRaw, colWidths[0] - cellPadding);

  var tableX = marginLeft;

  doc.setFillColor(240, 240, 240);
  doc.rect(tableX, y, contentWidth, 8, 'F');
  doc.setTextColor(50, 50, 50);

  var headerX = tableX + 2;
  for (var h = 0; h < tableHeaders.length; h++) {
    doc.text(tableHeaders[h], headerX, y + 5.5);
    headerX += colWidths[h];
  }
  y += 8;

  doc.setDrawColor(200, 200, 200);
  doc.line(tableX, y, tableX + contentWidth, y);

  y += 1;
  doc.setTextColor(0, 0, 0);

  var rowX = tableX + 2;
  doc.text(roomLabel, rowX, y + 5);
  rowX += colWidths[0];
  doc.text(datesStr, rowX, y + 5);
  rowX += colWidths[1];
  doc.text(nightsStr, rowX, y + 5);
  rowX += colWidths[2];
  doc.text(rateStr, rowX, y + 5);
  rowX += colWidths[3];
  doc.text(totalStr, rowX, y + 5);
  y += 8;

  doc.line(tableX, y, tableX + contentWidth, y);
  y += 2;

  // ─── Блок предоплаты ──────────────────────────────────────

  var prepayDesc = bookingData.nightsCount >= 3
    ? '3 суток проживания (' + '3 × ' + formatMoney(bookingData.nightlyRate) + ' руб./сут.)'
    : 'полная сумма (менее 3 ночей)';

  y += 2;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(
    'Предоплата: ' + prepayDesc,
    marginLeft,
    y
  );
  y += 6;

  // Синий блок «ПРЕДОПЛАТА»
  doc.setFillColor(26, 115, 232);
  doc.rect(marginLeft, y, contentWidth, 9, 'F');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'ПРЕДОПЛАТА: ' + formatMoney(bookingData.prepayAmount) + ' руб.',
    pageWidth / 2,
    y + 6.5,
    { align: 'center' }
  );
  y += 12;

  // Сумма прописью
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text(numberToWordsRu(bookingData.prepayAmount), marginLeft, y);
  y += 6;

  // ─── Доплата в отеле ──────────────────────────────────────

  doc.setFillColor(245, 166, 35);
  doc.rect(marginLeft, y, contentWidth, 9, 'F');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'ДОПЛАТА В ОТЕЛЕ: ' + formatMoney(surchargeAtHotel) + ' руб.',
    pageWidth / 2,
    y + 6.5,
    { align: 'center' }
  );
  y += 12;

  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(
    'Общая стоимость ' + formatMoney(bookingData.totalPrice) + ' руб.' +
    ' минус предоплата ' + formatMoney(bookingData.prepayAmount) + ' руб.',
    marginLeft,
    y
  );
  y += 6;

  // ─── Банковские реквизиты ─────────────────────────────────

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('Банковские реквизиты для оплаты:', marginLeft, y);
  y += 5;

  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);

  y = drawLabelValueCompact(doc, marginLeft, y, 'Получатель:', hotelDetails.name);
  y = drawLabelValueCompact(doc, marginLeft, y, 'ИНН:', hotelDetails.inn);
  y = drawLabelValueCompact(doc, marginLeft, y, 'Р/с:', hotelDetails.bankAccount);
  y = drawLabelValueCompact(doc, marginLeft, y, 'Банк:', hotelDetails.bankName);
  y = drawLabelValueCompact(doc, marginLeft, y, 'БИК:', hotelDetails.bik);
  y += 2;

  // ─── QR-коды для оплаты ───────────────────────────────────

  // Динамический размер QR: считаем сколько места осталось до конца страницы
  // Фиксированный контент после QR: подписи + назначение + примечание + директор ≈ 45мм
  var pageBottom = 284;
  var fixedAfterQR = 46;
  var availableForQR = pageBottom - y - fixedAfterQR;
  var qrSize = Math.min(44, Math.max(28, availableForQR - 16));
  var qrGap = 14;
  var qrBlockWidth = qrSize * 2 + qrGap;
  var qrStartX = marginLeft + (contentWidth - qrBlockWidth) / 2;

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('Оплата по QR-коду:', marginLeft, y);
  y += 5;

  // QR 1: Предоплата
  var prepayPurpose = 'Предоплата за проживание по бронированию ' +
    bookingData.bookingNumber + ', ' + (bookingData.guestName || '');
  var prepayQrData = buildPaymentQR(hotelDetails, bookingData.prepayAmount, prepayPurpose);
  var prepayQrImg = generateQRDataUrl(prepayQrData);

  if (prepayQrImg) {
    doc.addImage(prepayQrImg, 'PNG', qrStartX, y, qrSize, qrSize);
  }

  // Подпись под QR 1
  var qr1CenterX = qrStartX + qrSize / 2;
  doc.setFontSize(8);
  doc.setTextColor(26, 115, 232);
  doc.text('Предоплата', qr1CenterX, y + qrSize + 4, { align: 'center' });
  doc.setFontSize(9);
  doc.text(
    formatMoney(bookingData.prepayAmount) + ' руб.',
    qr1CenterX,
    y + qrSize + 9,
    { align: 'center' }
  );

  // QR 2: Полная оплата (со скидкой если есть)
  var fullPurpose = 'Оплата за проживание по бронированию ' +
    bookingData.bookingNumber + ', ' + (bookingData.guestName || '');
  var fullQrData = buildPaymentQR(hotelDetails, fullPayment, fullPurpose);
  var fullQrImg = generateQRDataUrl(fullQrData);

  var qr2X = qrStartX + qrSize + qrGap;

  if (fullQrImg) {
    doc.addImage(fullQrImg, 'PNG', qr2X, y, qrSize, qrSize);
  }

  // Подпись под QR 2
  var qr2CenterX = qr2X + qrSize / 2;
  doc.setFontSize(8);
  doc.setTextColor(52, 168, 83);

  if (discountPercent > 0) {
    doc.text(
      'Оплатить всю стоимость',
      qr2CenterX,
      y + qrSize + 4,
      { align: 'center' }
    );
    doc.text(
      'со скидкой ' + discountPercent + '%',
      qr2CenterX,
      y + qrSize + 9,
      { align: 'center' }
    );
    doc.setFontSize(8);
    doc.text(
      '(' + formatMoney(fullPayment) + ' вместо ' + formatMoney(bookingData.totalPrice) + ' руб.)',
      qr2CenterX,
      y + qrSize + 13,
      { align: 'center' }
    );
  } else {
    doc.text('Полная оплата', qr2CenterX, y + qrSize + 4, { align: 'center' });
    doc.setFontSize(9);
    doc.text(
      formatMoney(fullPayment) + ' руб.',
      qr2CenterX,
      y + qrSize + 9,
      { align: 'center' }
    );
  }

  y += discountPercent > 0 ? qrSize + 18 : qrSize + 14;

  // ─── Назначение платежа (выделенный блок) ───────────────

  doc.setDrawColor(26, 115, 232);
  doc.setLineWidth(0.5);
  var purposeText =
    'Оплата за проживание по бронированию ' +
    bookingData.bookingNumber +
    ', ' + (bookingData.guestName || '');
  doc.setFontSize(8);
  var splitPurpose = doc.splitTextToSize(purposeText, contentWidth - 10);
  var purposeBlockH = 7 + splitPurpose.length * 4 + 4; // +4 нижний паддинг

  doc.setFillColor(235, 245, 255);
  doc.roundedRect(marginLeft, y, contentWidth, purposeBlockH, 2, 2, 'FD');

  doc.setFontSize(8);
  doc.setTextColor(26, 115, 232);
  doc.text('Назначение платежа:', marginLeft + 4, y + 5);
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text(splitPurpose, marginLeft + 4, y + 10);
  y += purposeBlockH + 4;

  // ─── Примечание ──────────────────────────────────────────

  doc.setFontSize(6.5);
  doc.setTextColor(130, 130, 130);

  var note =
    'Счёт действителен в течение 3 (трёх) банковских дней. ' +
    'Оплата данного счёта означает согласие с условиями бронирования. ' +
    'Для оплаты отсканируйте QR-код в приложении банка.';
  var splitNote = doc.splitTextToSize(note, contentWidth);
  doc.text(splitNote, marginLeft, y);
  y += splitNote.length * 3 + 6;

  // ─── Подпись директора (всё на одной строке) ──────────────

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 8;

  var signatureLineY = y; // линия «Директор ___подпись___ / ФИО /»
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  var directorPrefix = 'Директор ' + hotelDetails.name;
  var directorSuffix = '/ Иванчей Е.А. /';
  var prefixWidth = doc.getTextWidth(directorPrefix);
  var signLineX = marginLeft + prefixWidth + 4;
  var suffixX = signLineX + 40;

  // Печать и подпись по центру линии подписи (___________)
  if (typeof STAMP_IMAGE_BASE64 !== 'undefined' && STAMP_IMAGE_BASE64) {
    var stampW = 56;
    var stampH = 56 * (1600 / 747);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.75 }));
    doc.addImage(
      'data:image/png;base64,' + STAMP_IMAGE_BASE64,
      'PNG',
      signLineX + 10, signatureLineY - stampH * 0.50,
      stampW, stampH
    );
    doc.restoreGraphicsState();
  }
  if (typeof SIGNATURE_IMAGE_BASE64 !== 'undefined' && SIGNATURE_IMAGE_BASE64) {
    var sigW = 30;
    var sigH = 30 * (1280 / 597);
    doc.addImage(
      'data:image/png;base64,' + SIGNATURE_IMAGE_BASE64,
      'PNG',
      signLineX - 2, signatureLineY - sigH * 0.55,
      sigW, sigH
    );
  }

  // Текст поверх изображений
  doc.text(directorPrefix, marginLeft, signatureLineY);
  doc.text('___________________', signLineX, signatureLineY);
  doc.text(directorSuffix, suffixX, signatureLineY);

  // ─── Формирование результата ─────────────────────────────

  var pdfBlob = doc.output('blob');
  var pdfBase64 = doc.output('datauristring').split(',')[1];

  var filename =
    'Счет_предоплата_' +
    invoiceNumber.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_') +
    '.pdf';

  return {
    blob: pdfBlob,
    base64: pdfBase64,
    filename: filename
  };
}

// ─── Вспомогательные функции для PDF ──────────────────────────

function registerCyrillicFont(doc) {
  if (typeof ROBOTO_FONT_BASE64 !== 'undefined' && ROBOTO_FONT_BASE64) {
    doc.addFileToVFS('Roboto-Regular.ttf', ROBOTO_FONT_BASE64);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.setFont('Roboto');
  } else {
    console.warn('[KonturPrepay] Шрифт Roboto не найден — кириллица может отображаться некорректно');
  }
}

function drawLabelValue(doc, x, y, label, value) {
  var labelWidth = doc.getTextWidth(label) + 2;
  doc.setTextColor(100, 100, 100);
  doc.text(label, x, y);
  doc.setTextColor(0, 0, 0);
  doc.text(value || '—', x + labelWidth, y);
  return y + 5;
}

function drawLabelValueCompact(doc, x, y, label, value) {
  var labelWidth = doc.getTextWidth(label) + 2;
  doc.setTextColor(100, 100, 100);
  doc.text(label, x, y);
  doc.setTextColor(0, 0, 0);
  doc.text(value || '—', x + labelWidth, y);
  return y + 4;
}

function formatMoney(amount) {
  if (!amount && amount !== 0) {
    return '0';
  }
  return String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function truncateText(text, maxLen) {
  if (!text) {
    return '';
  }
  if (text.length <= maxLen) {
    return text;
  }
  return text.substring(0, maxLen - 3) + '...';
}

/**
 * Вычисляет ширины колонок таблицы по фактическому размеру текста.
 * @param {Object} doc — документ jsPDF (шрифт и размер уже заданы)
 * @param {number} totalWidth — общая доступная ширина (mm)
 * @param {string[]} headers — заголовки колонок
 * @param {string[]} cells — содержимое ячеек
 * @param {number[]} minWidths — минимальные ширины колонок (mm)
 * @returns {number[]} colWidths
 */
function calcTableColumnWidths(doc, totalWidth, headers, cells, minWidths) {
  var result = [];
  var padding = 2;
  for (var i = 0; i < headers.length; i++) {
    var w = Math.max(
      doc.getTextWidth(headers[i] || '') + padding,
      doc.getTextWidth(cells[i] || '') + padding,
      minWidths[i] || 10
    );
    result.push(w);
  }
  var sum = result.reduce(function (a, b) {
    return a + b;
  }, 0);
  if (sum > totalWidth) {
    var overflow = sum - totalWidth;
    result[0] = Math.max(minWidths[0], result[0] - overflow);
  } else if (sum < totalWidth) {
    result[0] += totalWidth - sum;
  }
  return result;
}

/**
 * Обрезает текст до заданной ширины (mm), добавляя «...» при необходимости.
 */
function truncateToWidth(doc, text, maxWidthMm) {
  if (!text) return '';
  if (doc.getTextWidth(text) <= maxWidthMm) return text;
  var s = text;
  while (s.length > 2 && doc.getTextWidth(s + '...') > maxWidthMm) {
    s = s.substring(0, s.length - 1);
  }
  return s + '...';
}

function generateInvoiceNumber(bookingNumber) {
  var now = new Date();
  var dateStr =
    String(now.getFullYear()) +
    padZero(now.getMonth() + 1) +
    padZero(now.getDate());

  var booking = bookingNumber || 'N' + dateStr;
  return dateStr + '-' + booking;
}

function formatCurrentDate() {
  var months = [
    'января', 'февраля', 'марта', 'апреля',
    'мая', 'июня', 'июля', 'августа',
    'сентября', 'октября', 'ноября', 'декабря'
  ];
  var now = new Date();
  return now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear() + ' г.';
}

function padZero(num) {
  return num < 10 ? '0' + num : String(num);
}

function numberToWordsRu(amount) {
  if (!amount || amount <= 0) {
    return 'Ноль рублей 00 копеек';
  }

  amount = Math.round(amount);

  var units = [
    '', 'один', 'два', 'три', 'четыре', 'пять',
    'шесть', 'семь', 'восемь', 'девять'
  ];
  var teens = [
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
    'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'
  ];
  var tens = [
    '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
    'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'
  ];
  var hundreds = [
    '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
    'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'
  ];

  var parts = [];

  var thousands = Math.floor(amount / 1000);
  if (thousands > 0) {
    if (thousands >= 100) {
      parts.push(hundreds[Math.floor(thousands / 100)]);
      thousands = thousands % 100;
    }
    if (thousands >= 10 && thousands < 20) {
      parts.push(teens[thousands - 10]);
      thousands = 0;
    } else if (thousands >= 20) {
      parts.push(tens[Math.floor(thousands / 10)]);
      thousands = thousands % 10;
    }
    if (thousands > 0) {
      if (thousands === 1) {
        parts.push('одна');
      } else if (thousands === 2) {
        parts.push('две');
      } else {
        parts.push(units[thousands]);
      }
    }

    var th = Math.floor(amount / 1000) % 100;
    var thUnit = th % 10;
    if (th >= 11 && th <= 19) {
      parts.push('тысяч');
    } else if (thUnit === 1) {
      parts.push('тысяча');
    } else if (thUnit >= 2 && thUnit <= 4) {
      parts.push('тысячи');
    } else {
      parts.push('тысяч');
    }
  }

  var remainder = amount % 1000;
  if (remainder >= 100) {
    parts.push(hundreds[Math.floor(remainder / 100)]);
    remainder = remainder % 100;
  }
  if (remainder >= 10 && remainder < 20) {
    parts.push(teens[remainder - 10]);
    remainder = 0;
  } else if (remainder >= 20) {
    parts.push(tens[Math.floor(remainder / 10)]);
    remainder = remainder % 10;
  }
  if (remainder > 0) {
    parts.push(units[remainder]);
  }

  if (parts.length === 0) {
    parts.push('ноль');
  }

  var rub = amount % 100;
  var rubUnit = rub % 10;
  var rubWord;
  if (rub >= 11 && rub <= 19) {
    rubWord = 'рублей';
  } else if (rubUnit === 1) {
    rubWord = 'рубль';
  } else if (rubUnit >= 2 && rubUnit <= 4) {
    rubWord = 'рубля';
  } else {
    rubWord = 'рублей';
  }

  var text = parts.join(' ');
  text = text.charAt(0).toUpperCase() + text.slice(1);

  return text + ' ' + rubWord + ' 00 копеек';
}

// ─── QR-код для оплаты ────────────────────────────────────────

/**
 * Формирует строку платёжного QR-кода по ГОСТ Р 56042-2014.
 *
 * Формат: ST00012|Name=...|PersonalAcc=...|BankName=...|BIC=...|CorrespAcc=...|PayeeINN=...|Sum=...|Purpose=...
 *
 * ST00012 = UTF-8 кодировка (версия формата 0001, кодировка 2 = UTF-8)
 * Сумма передаётся в копейках (целое число).
 */
function buildPaymentQR(hotel, amountRub, purpose) {
  var sumKopeks = String(Math.round(amountRub * 100));

  var parts = [
    'ST00012',
    'Name=' + hotel.name,
    'PersonalAcc=' + hotel.bankAccount,
    'BankName=' + hotel.bankName,
    'BIC=' + hotel.bik,
    'CorrespAcc=' + hotel.corrAccount,
    'PayeeINN=' + hotel.inn,
    'KPP=' + hotel.kpp,
    'Sum=' + sumKopeks,
    'Purpose=' + purpose
  ];

  return parts.join('|');
}

/**
 * Генерирует QR-код как data URL (PNG изображение).
 *
 * ВАЖНО: Кириллица кодируется в UTF-8 байты вручную,
 * т.к. qrcode-generator по умолчанию использует Latin-1
 * и ломает многобайтовые символы.
 *
 * Используем: encodeURIComponent + unescape → UTF-8 байт-строка,
 * затем addData(..., 'Byte') для побайтовой записи в QR.
 */
function generateQRDataUrl(data) {
  if (typeof qrcode === 'undefined') {
    console.error('[KonturPrepay] Библиотека qrcode не загружена');
    return null;
  }

  try {
    // Конвертируем Unicode-строку в строку UTF-8 байтов
    // encodeURIComponent кодирует каждый символ как %XX%YY...
    // unescape превращает %XX обратно в символы (но уже однобайтовые)
    var utf8ByteString = unescape(encodeURIComponent(data));

    // typeNumber=0 → автоопределение, 'M' → средняя коррекция ошибок
    var qr = qrcode(0, 'M');
    // 'Byte' — режим побайтовой записи (не пытается интерпретировать как текст)
    qr.addData(utf8ByteString, 'Byte');
    qr.make();

    return qr.createDataURL(4, 2);
  } catch (error) {
    console.error('[KonturPrepay] Ошибка генерации QR:', error);
    return null;
  }
}
