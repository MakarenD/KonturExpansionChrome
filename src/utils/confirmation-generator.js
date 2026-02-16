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
  doc.text('ПОДТВЕРЖДЕНИЕ БРОНИРОВАНИЯ', pageWidth / 2, y, { align: 'center' });
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

  if (bookingData.guestCount) {
    y = drawLabelValue(
      doc, marginLeft, y,
      'Количество гостей:',
      String(bookingData.guestCount)
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

  var checkInTimeStr = bookingData.checkInTime || '15:00';
  var checkOutTimeStr = bookingData.checkOutTime || '12:00';

  var policies = [
    'Заезд с ' + checkInTimeStr + ', выезд до ' + checkOutTimeStr,
    'При заезде необходимо предъявить документ, удостоверяющий личность',
    'Оплата оставшейся суммы производится при заселении'
  ];

  for (var p = 0; p < policies.length; p++) {
    doc.text('\u2022 ' + policies[p], marginLeft + 2, y);
    y += 5;
  }
  y += 8;

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
