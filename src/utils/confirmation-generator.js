/**
 * Генератор PDF подтверждения бронирования.
 *
 * Использует jsPDF для формирования PDF-документа.
 * Переиспользует вспомогательные функции из invoice-generator.js:
 *  - registerCyrillicFont, drawLabelValue, formatMoney,
 *    formatCurrentDate, numberToWordsRu
 *
 * Зависимости (загружены ранее):
 *  - jspdf.umd.min.js   → глобальная переменная jspdf
 *  - roboto-regular.js   → глобальная переменная ROBOTO_FONT_BASE64
 *  - stamp-signature.js  → STAMP_IMAGE_BASE64, SIGNATURE_IMAGE_BASE64
 *  - hotel-details.js    → глобальная переменная HOTEL_DETAILS
 *  - invoice-generator.js → вспомогательные функции (registerCyrillicFont и т.д.)
 */

/**
 * Генерирует PDF подтверждения бронирования.
 *
 * @param {Object} bookingData — данные бронирования (из parseBookingData)
 * @param {Object} hotelDetails — реквизиты отеля (HOTEL_DETAILS)
 * @returns {{ blob: Blob, base64: string, filename: string }}
 */
function generateConfirmationPDF(bookingData, hotelDetails) {
  var jsPDF = jspdf.jsPDF;
  var doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  registerCyrillicFont(doc);

  var pageWidth = 210;
  var marginLeft = 20;
  var marginRight = 20;
  var contentWidth = pageWidth - marginLeft - marginRight;

  var y = 20;

  // ─── Шапка: реквизиты отеля ──────────────────────────────

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

  // ─── Заголовок ────────────────────────────────────────────

  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text('ПОДТВЕРЖДЕНИЕ БРОНИРОВАНИЯ (ВАУЧЕР)', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(11);
  doc.text(
    '№ ' + (bookingData.bookingNumber || '—'),
    pageWidth / 2,
    y,
    { align: 'center' }
  );
  y += 6;

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text('от ' + formatCurrentDate(), pageWidth / 2, y, { align: 'center' });
  y += 12;

  // ─── Информация о госте ───────────────────────────────────

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('Информация о госте', marginLeft, y);
  y += 7;

  doc.setFontSize(10);
  y = drawLabelValue(doc, marginLeft, y, 'ФИО:', bookingData.guestName || '—');

  if (bookingData.guestEmail) {
    y = drawLabelValue(doc, marginLeft, y, 'Email:', bookingData.guestEmail);
  }
  if (bookingData.guestPhone) {
    y = drawLabelValue(doc, marginLeft, y, 'Телефон:', bookingData.guestPhone);
  }
  y += 8;

  // ─── Детали бронирования ──────────────────────────────────

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('Детали бронирования', marginLeft, y);
  y += 7;

  doc.setFontSize(10);
  y = drawLabelValue(doc, marginLeft, y, 'Категория номера:', bookingData.roomType || '—');

  var checkInStr = bookingData.checkIn || '—';
  if (bookingData.checkInTime) {
    checkInStr += ', заезд с ' + bookingData.checkInTime;
  }
  y = drawLabelValue(doc, marginLeft, y, 'Дата заезда:', checkInStr);

  var checkOutStr = bookingData.checkOut || '—';
  if (bookingData.checkOutTime) {
    checkOutStr += ', выезд до ' + bookingData.checkOutTime;
  }
  y = drawLabelValue(doc, marginLeft, y, 'Дата выезда:', checkOutStr);

  y = drawLabelValue(
    doc, marginLeft, y,
    'Количество ночей:',
    String(bookingData.nightsCount || '—')
  );

  if (bookingData.guestCount && bookingData.guestCount.total > 0) {
    y = drawLabelValue(
      doc, marginLeft, y,
      'Количество гостей:',
      bookingData.guestCount.text || String(bookingData.guestCount.total)
    );
  }
  y += 8;

  // ─── Стоимость проживания ─────────────────────────────────

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('Стоимость проживания', marginLeft, y);
  y += 7;

  doc.setFontSize(10);
  y = drawLabelValue(
    doc, marginLeft, y,
    'Общая стоимость:',
    formatMoney(bookingData.totalPrice) + ' руб.'
  );
  y = drawLabelValue(
    doc, marginLeft, y,
    'Внесённая оплата:',
    formatMoney(bookingData.paidAmount || 0) + ' руб.'
  );
  y += 4;

  // Рассчитываем остаток к оплате
  var remainingAmount = bookingData.debtAmount ||
    (bookingData.totalPrice - (bookingData.paidAmount || 0));
  if (remainingAmount < 0) {
    remainingAmount = 0;
  }

  // Зелёный блок «К ОПЛАТЕ В ОТЕЛЕ»
  doc.setFillColor(52, 168, 83);
  doc.rect(marginLeft, y, contentWidth, 10, 'F');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'К ОПЛАТЕ В ОТЕЛЕ: ' + formatMoney(remainingAmount) + ' руб.',
    pageWidth / 2,
    y + 7,
    { align: 'center' }
  );
  y += 14;

  // Синий блок «ОПЛАЧЕНО» (только если есть оплата)
  if (bookingData.paidAmount > 0) {
    doc.setFillColor(26, 115, 232);
    doc.rect(marginLeft, y, contentWidth, 10, 'F');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text(
      'ОПЛАЧЕНО: ' + formatMoney(bookingData.paidAmount) + ' руб.',
      pageWidth / 2,
      y + 7,
      { align: 'center' }
    );
    y += 14;
  }

  // Сумма прописью
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(
    'К оплате в отеле: ' + numberToWordsRu(remainingAmount),
    marginLeft,
    y
  );
  y += 10;

  // ─── Условия проживания ───────────────────────────────────

  doc.setDrawColor(200, 200, 200);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('Условия проживания:', marginLeft, y);
  y += 6;

  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);

  var bulletIndent = marginLeft + 2;
  var bulletTextWidth = contentWidth - 4;

  var policies = [
    'Заезд с 15:00, выезд до 12:00.',
    'При заезде необходимо предъявить паспорта граждан РФ на всех проживающих, свидетельства о рождении на детей, ваучер и квитанцию об оплате.',
    'Оплата оставшейся суммы производится при заселении.',
    'Дети до 4-х лет включительно размещаются и питаются бесплатно (без предоставления доп. места).'
  ];

  for (var p = 0; p < policies.length; p++) {
    var policyLines = doc.splitTextToSize('\u2022 ' + policies[p], bulletTextWidth);
    doc.text(policyLines, bulletIndent, y);
    y += policyLines.length * 4.5;
  }
  y += 3;

  // «В стоимость номера включено» — подсекция
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('\u2022 В стоимость номера включено:', bulletIndent, y);
  y += 5;

  var inclusions = [
    'Проживание в номере выбранного типа',
    'Трехразовое питание по системе «шведский стол»',
    'Комплекс бассейнов (при благоприятных погодных условиях)',
    'Детские центры «Альби» и «Островок»',
    'Развлекательные программы',
    'Охраняемая парковка',
    'Спа-комплекс'
  ];

  for (var inc = 0; inc < inclusions.length; inc++) {
    doc.text('    – ' + inclusions[inc], marginLeft + 4, y);
    y += 4.5;
  }
  y += 6;

  // ─── Условия отмены бронирования ──────────────────────────

  // Проверяем, хватает ли места на странице
  if (y + 30 > 275) {
    doc.addPage();
    y = 20;
  }

  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('Условия отмены бронирования:', marginLeft, y);
  y += 6;

  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);

  var cancelPolicy =
    'Изменение бронирования осуществляется не позднее, чем за 15 (пятнадцать) календарных дней ' +
    'до заявленной даты заезда. В случае отмены бронирования менее, чем за 15 (пятнадцать) ' +
    'календарных дней до заявленной даты заезда, с Заказчика удерживается плата в размере полной ' +
    'стоимости (без учета скидок, если таковые применялись при оплате) 1 (одних) суток проживания ' +
    'за каждый забронированный номер.';
  var splitCancel = doc.splitTextToSize(cancelPolicy, contentWidth - 4);
  doc.text(splitCancel, marginLeft + 2, y);
  y += splitCancel.length * 4 + 6;

  // ─── Контактная информация ────────────────────────────────

  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('Контактная информация:', marginLeft, y);
  y += 6;

  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('Телефон: ' + hotelDetails.phone, marginLeft, y);
  y += 4;
  doc.text('Email: ' + hotelDetails.email, marginLeft, y);
  y += 4;
  doc.text('Адрес отеля: ' + hotelDetails.address, marginLeft, y);
  y += 12;

  // ─── Приветственная надпись ────────────────────────────────

  doc.setFontSize(11);
  doc.setTextColor(52, 168, 83);
  doc.text(
    'Спасибо за выбор нашего отеля! Ждём вас!',
    pageWidth / 2,
    y,
    { align: 'center' }
  );
  y += 8;

  // ─── Примечание ───────────────────────────────────────────

  doc.setFontSize(7);
  doc.setTextColor(130, 130, 130);

  var note =
    'Данное подтверждение является официальным документом, подтверждающим бронирование номера. ' +
    'Просьба сохранить его и предъявить при заселении.';
  var splitNote = doc.splitTextToSize(note, contentWidth);
  doc.text(splitNote, marginLeft, y);
  y += splitNote.length * 3.5 + 10;

  // ─── Подпись директора (всё на одной строке) ──────────────

  if (y + 35 > 285) {
    doc.addPage();
    y = 20;
  }

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 8;

  var signatureLineY = y;
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  var directorPrefix = 'Директор ' + hotelDetails.name;
  var directorSuffix = '/ Иванчей Е.А. /';
  var prefixWidth = doc.getTextWidth(directorPrefix);
  var signLineX = marginLeft + prefixWidth + 4;
  var suffixX = signLineX + 40;

  // Печать и подпись по центру линии подписи (___________)
  if (typeof STAMP_IMAGE_BASE64 !== 'undefined' && STAMP_IMAGE_BASE64) {
    var stampW = 42;
    var stampH = 42 * (1600 / 747);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.75 }));
    doc.addImage(
      'data:image/png;base64,' + STAMP_IMAGE_BASE64,
      'PNG',
      signLineX + 10, signatureLineY - stampH * 0.55,
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

  // ─── Формирование результата ──────────────────────────────

  var pdfBlob = doc.output('blob');
  var pdfBase64 = doc.output('datauristring').split(',')[1];

  var filename =
    'Подтверждение_' +
    (bookingData.bookingNumber || 'бронирования').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_') +
    '.pdf';

  return {
    blob: pdfBlob,
    base64: pdfBase64,
    filename: filename
  };
}
