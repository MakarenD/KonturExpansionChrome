/**
 * Модуль парсинга данных бронирования из DOM hotel.kontur.ru
 *
 * Контур Отель использует хешированные CSS-классы (меняются при обновлениях),
 * поэтому парсер опирается на:
 *  1. URL страницы (/bookings/daily/id/...)
 *  2. Текстовые маркеры разделов ("Оплата", "Гости", "Информация")
 *  3. Паттерны данных (OTL-..., email-regex, цена ₽)
 *  4. Структурные отношения элементов (соседние div-ы, родители)
 *
 * Расчёт:
 *  - Предоплата = стоимость первых 3 суток
 *  - Скидка: 4–5 ночей → 5%, 6+ ночей → 8%
 */

// ─── Селекторы и маркеры ──────────────────────────────────────
//
// Конфигурация: текстовые маркеры разделов и паттерны данных.
// Если Контур Отель изменит заголовки — обновить здесь.

var BOOKING_SELECTORS = {

  // Контейнер страницы бронирования (стабильный id)
  container: [
    '#MainPageTopBar'
  ],

  // Область для вставки кнопки — рядом с «Другие действия»
  buttonArea: [
    '[data-oid="MainPageTab"]'
  ],

  // Текстовые маркеры разделов (для поиска по textContent)
  sectionLabels: {
    payment: 'Оплата',
    guests: 'Гости',
    info: 'Информация',
    payer: 'Плательщик'
  }
};

// ─── Главная функция парсинга ─────────────────────────────────

/**
 * Извлекает данные бронирования из текущей страницы.
 *
 * @returns {Object|null}
 */
function parseBookingData() {
  // Проверяем что мы на странице бронирования
  if (!isBookingPage()) {
    console.warn('[KonturPrepay] Текущая страница не является бронированием');
    return null;
  }

  var container = document.getElementById('MainPageTopBar');
  if (!container) {
    console.warn('[KonturPrepay] Контейнер #MainPageTopBar не найден');
    return null;
  }

  var pageText = container.textContent || '';

  // 1. Номер бронирования — из заголовка (формат "OTL-0000000015: даты")
  var bookingNumber = parseBookingNumber(pageText);

  // 2. Даты заезда/выезда — из заголовка или секции деталей
  var dates = parseDates(pageText);

  // 3. Тип номера — первый текст в блоке деталей номера
  var roomType = parseRoomType(container);

  // 4. Номер комнаты
  var roomNumber = parseRoomNumber(container);

  // 5. Стоимость — число перед ₽ в секции «Оплата»
  var totalPrice = parseTotalPrice(container, pageText);

  // 6. ФИО гостя — из секции «Информация»
  var guestName = parseGuestName(container);

  // 7. Email гостя — из секции «Информация»
  var guestEmail = parseGuestEmail(container, pageText);

  // 8. Телефон гостя
  var guestPhone = parseGuestPhone(pageText);

  // Рассчитываем ночи
  var nightsCount = 0;
  if (dates.checkIn && dates.checkOut) {
    nightsCount = calculateNights(dates.checkIn, dates.checkOut);
  }
  // Если из дат не удалось — пробуем найти число ночей в тексте
  if (nightsCount <= 0) {
    nightsCount = parseNightsFromText(pageText);
  }

  // Стоимость за сутки
  var nightlyRate = nightsCount > 0 ? Math.round(totalPrice / nightsCount) : 0;

  // Предоплата = первые 3 суток
  var prepayNights = Math.min(3, nightsCount);
  var prepayAmount = nightlyRate * prepayNights;

  // Скидка
  var discountPercent = calculateDiscount(nightsCount);
  var discountAmount = Math.round(totalPrice * discountPercent / 100);
  var fullPaymentWithDiscount = totalPrice - discountAmount;

  // Описание комнаты — только категория, без номера
  var roomDesc = roomType || '';

  var result = {
    guestName: guestName || '',
    guestEmail: guestEmail || '',
    guestPhone: guestPhone || '',
    checkIn: dates.checkIn || '',
    checkOut: dates.checkOut || '',
    roomType: roomDesc,
    totalPrice: totalPrice,
    bookingNumber: bookingNumber || '',
    nightsCount: nightsCount,
    nightlyRate: nightlyRate,
    prepayAmount: prepayAmount,
    discountPercent: discountPercent,
    discountAmount: discountAmount,
    fullPaymentWithDiscount: fullPaymentWithDiscount
  };

  console.log('[KonturPrepay] Данные бронирования:', result);
  return result;
}

// ─── Проверка страницы ────────────────────────────────────────

/** Проверяет, что текущий URL — страница бронирования. */
function isBookingPage() {
  return /\/bookings\/.*\/id\//.test(window.location.pathname);
}

// ─── Парсеры отдельных полей ──────────────────────────────────

/** Извлекает номер бронирования (формат OTL-XXXXXXX). */
function parseBookingNumber(text) {
  var match = text.match(/OTL-\d+/);
  return match ? match[0] : null;
}

/**
 * Извлекает даты заезда и выезда.
 *
 * Заголовок формата: "OTL-0000000015: 9 - 12 мая"
 * Или в деталях: "9 - 12 мая" с количеством ночей.
 *
 * Поддерживаемые форматы:
 *  - "9 - 12 мая" (один месяц)
 *  - "28 апр - 3 мая" (разные месяцы)
 *  - "28 апреля - 3 мая 2026" (полные названия)
 */
function parseDates(text) {
  var MONTHS = {
    'янв': 0, 'января': 0,
    'фев': 1, 'февраля': 1,
    'мар': 2, 'марта': 2,
    'апр': 3, 'апреля': 3,
    'мая': 4, 'май': 4,
    'июн': 5, 'июня': 5,
    'июл': 6, 'июля': 6,
    'авг': 7, 'августа': 7,
    'сен': 8, 'сентября': 8,
    'окт': 9, 'октября': 9,
    'ноя': 10, 'ноября': 10,
    'дек': 11, 'декабря': 11
  };

  var currentYear = new Date().getFullYear();

  // Список всех допустимых названий месяцев для точного сопоставления
  var monthNames = Object.keys(MONTHS);

  // Формат "DD - DD месяц" (один месяц)
  // Без флага /i — месяцы всегда в нижнем регистре,
  // а без /i regex [а-яё] не захватывает заглавные буквы следующих слов
  var sameMonth = text.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([а-яё]{3,8})/);
  if (sameMonth) {
    var monthIdx = MONTHS[sameMonth[3]];
    if (monthIdx !== undefined) {
      var d1 = parseInt(sameMonth[1], 10);
      var d2 = parseInt(sameMonth[2], 10);
      return {
        checkIn: formatDateRu(d1, monthIdx, currentYear),
        checkOut: formatDateRu(d2, monthIdx, currentYear)
      };
    }
  }

  // Формат "DD месяц - DD месяц" (разные месяцы)
  var diffMonth = text.match(/(\d{1,2})\s+([а-яё]{3,8})\s*[-–]\s*(\d{1,2})\s+([а-яё]{3,8})/);
  if (diffMonth) {
    var m1 = MONTHS[diffMonth[2]];
    var m2 = MONTHS[diffMonth[4]];
    if (m1 !== undefined && m2 !== undefined) {
      return {
        checkIn: formatDateRu(parseInt(diffMonth[1], 10), m1, currentYear),
        checkOut: formatDateRu(parseInt(diffMonth[3], 10), m2, currentYear)
      };
    }
  }

  // Формат DD.MM.YYYY - DD.MM.YYYY
  var dotFormat = text.match(/(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})/);
  if (dotFormat) {
    return { checkIn: dotFormat[1], checkOut: dotFormat[2] };
  }

  return { checkIn: null, checkOut: null };
}

/** Форматирует дату как "DD.MM.YYYY". */
function formatDateRu(day, monthIndex, year) {
  var dd = day < 10 ? '0' + day : String(day);
  var mm = (monthIndex + 1) < 10 ? '0' + (monthIndex + 1) : String(monthIndex + 1);
  return dd + '.' + mm + '.' + year;
}

/** Извлекает тип номера (первый заголовок в деталях). */
function parseRoomType(container) {
  // Ищем текст первого заголовка секции деталей номера
  // Структура: div с текстом типа "Двухкомнатный люкс" перед номером комнаты
  // Он находится в первом блоке после табов
  var allDivs = container.querySelectorAll('div');
  for (var i = 0; i < allDivs.length; i++) {
    var div = allDivs[i];
    var t = (div.textContent || '').trim();
    // Ищем div который содержит ТОЛЬКО название категории
    // (не содержит "Оплата", номера, дат и т.д.)
    if (div.children.length === 0 || (div.children.length === 1 && div.children[0].tagName === 'SPAN')) {
      // Проверяем что это похоже на название категории номера
      if (t && t.length > 3 && t.length < 60 &&
          !t.match(/\d/) &&
          !t.match(/Оплата|Гости|Информация|Плательщик|Комментарий|Задачи|Услуги|История|Расчет|Бронирование/) &&
          !t.match(/₽|руб|долг|оплачено|Тариф|Заселить/) &&
          !t.match(/@|http|OTL/) &&
          t.match(/[а-яА-ЯёЁ]/) &&
          div.closest('[data-oid="MainPageTab"]') === null) {
        // Проверяем, что этот элемент находится в области деталей номера
        var parent = div.parentElement;
        if (parent) {
          var siblingText = parent.textContent || '';
          // Рядом должен быть номер комнаты (число 1-999)
          if (siblingText.match(/\b\d{1,3}\b/) && siblingText.length < 200) {
            return t;
          }
        }
      }
    }
  }

  // Фоллбэк: ищем элемент, текст которого похож на название категории
  // и находится перед номером комнаты
  var spans = container.querySelectorAll('span');
  for (var j = 0; j < spans.length; j++) {
    var span = spans[j];
    var st = (span.textContent || '').trim();
    if (st && st.length > 5 && st.length < 50 &&
        !st.match(/\d/) &&
        st.match(/номер|люкс|стандарт|комфорт|эконом|студия|сюит|апартамент|полулюкс|двух|одно|трёх|четырёх|семейн|делюкс/i)) {
      return st;
    }
  }

  return null;
}

/** Извлекает номер комнаты. */
function parseRoomNumber(container) {
  // Номер комнаты в Контуре отображается как отдельное число (101, 202 и т.д.)
  // рядом с иконкой редактирования
  var allSpans = container.querySelectorAll('span');
  for (var i = 0; i < allSpans.length; i++) {
    var span = allSpans[i];
    var t = (span.textContent || '').trim();
    // Ищем span с числом 1-9999, у которого нет других вложенных элементов
    // и который является номером комнаты (находится рядом с типом номера)
    if (/^\d{1,4}$/.test(t) && parseInt(t, 10) > 0 && parseInt(t, 10) < 10000) {
      // Проверяем что рядом есть кнопка редактирования (иконка карандаша)
      var parent = span.closest('div');
      if (parent) {
        var parentHtml = parent.innerHTML || '';
        if (parentHtml.indexOf('svg') !== -1 || parentHtml.indexOf('edit') !== -1 ||
            parentHtml.indexOf('Edit') !== -1 || parentHtml.indexOf('pencil') !== -1 ||
            parentHtml.indexOf('Icon__root') !== -1) {
          return t;
        }
      }
    }
  }
  return null;
}

/** Извлекает полную стоимость. */
function parseTotalPrice(container, text) {
  // Ищем секцию «Оплата» и берём из неё сумму
  var paymentSection = findSectionByLabel(container, 'Оплата');

  if (paymentSection) {
    var sectionText = paymentSection.textContent || '';
    // Ищем "ЧИСЛО ₽" — общая сумма (обычно "оплачено из СУММА ₽")
    var fromMatch = sectionText.match(/из\s+([\d\s\u00a0]+)\s*₽/);
    if (fromMatch) {
      return parsePrice(fromMatch[1]);
    }
    // Или первое число перед ₽
    var priceMatch = sectionText.match(/([\d\s\u00a0]+)\s*₽/);
    if (priceMatch) {
      return parsePrice(priceMatch[1]);
    }
  }

  // Фоллбэк: ищем "из СУММА ₽" во всём тексте
  var fallback = text.match(/из\s+([\d\s\u00a0]+)\s*₽/);
  if (fallback) {
    return parsePrice(fallback[1]);
  }

  // Ещё фоллбэк: первое число перед ₽ больше 1000
  var allPrices = text.match(/([\d\s\u00a0]+)\s*₽/g);
  if (allPrices) {
    for (var i = 0; i < allPrices.length; i++) {
      var p = parsePrice(allPrices[i]);
      if (p >= 1000) {
        return p;
      }
    }
  }

  return 0;
}

/** Извлекает ФИО гостя из секции «Информация». */
function parseGuestName(container) {
  // Ищем секцию «Информация»
  var infoSection = findSectionByLabel(container, 'Информация');
  if (infoSection) {
    // В секции «Информация» ФИО — это текст рядом с иконкой человека,
    // обычно первый текстовый элемент после иконки
    var spans = infoSection.querySelectorAll('div, span');
    for (var i = 0; i < spans.length; i++) {
      var t = (spans[i].textContent || '').trim();
      // ФИО: 2-4 слова из кириллицы, без цифр и спецсимволов
      if (t.match(/^[А-ЯЁа-яё]+\s+[А-ЯЁа-яё]+(\s+[А-ЯЁа-яё]+)?(\s+[А-ЯЁа-яё]+)?$/) &&
          t.length > 5 && t.length < 80 &&
          spans[i].children.length === 0) {
        return t;
      }
    }
  }

  // Фоллбэк: ищем в секции «Гости»
  var guestsSection = findSectionByLabel(container, 'Гости');
  if (guestsSection) {
    var guestSpans = guestsSection.querySelectorAll('div, span');
    for (var j = 0; j < guestSpans.length; j++) {
      var gt = (guestSpans[j].textContent || '').trim();
      if (gt.match(/^[А-ЯЁа-яё]+\s+[А-ЯЁа-яё]+(\s+[А-ЯЁа-яё]+)?$/) &&
          gt.length > 5 && gt.length < 80 &&
          guestSpans[j].children.length === 0) {
        return gt;
      }
    }
  }

  return null;
}

/** Извлекает email гостя. */
function parseGuestEmail(container, text) {
  // Ищем в секции «Информация»
  var infoSection = findSectionByLabel(container, 'Информация');
  var searchText = infoSection ? (infoSection.textContent || '') : text;

  var emailMatch = searchText.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return emailMatch ? emailMatch[0] : null;
}

/** Извлекает телефон гостя. */
function parseGuestPhone(text) {
  var phoneMatch = text.match(/\+?\d[\d\s()-]{9,}/);
  if (phoneMatch) {
    return phoneMatch[0].trim();
  }
  return null;
}

/** Извлекает количество ночей из текста (число перед иконкой луны). */
function parseNightsFromText(text) {
  // В Контуре количество ночей отображается как "3" перед иконкой луны
  // В тексте это будет "DD - DD месяц 3 15:00 12:00" или подобное
  // Ищем одиночное число 1-99 между датами и временем
  var match = text.match(/[а-яё]\s+(\d{1,2})\s*[☽🌙]/);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Фоллбэк: ищем число между месяцем и временем
  var match2 = text.match(/[а-яё]+\.?\s+(\d{1,2})\s+\d{1,2}:\d{2}/);
  if (match2) {
    var n = parseInt(match2[1], 10);
    if (n >= 1 && n <= 90) {
      return n;
    }
  }

  return 0;
}

// ─── Поиск секций по тексту заголовка ─────────────────────────

/**
 * Находит DOM-секцию по текстовому заголовку.
 *
 * Ищет элемент, содержащий точный текст заголовка,
 * и возвращает ближайший родительский контейнер секции.
 *
 * @param {Element} container
 * @param {string} label — текст заголовка ("Оплата", "Гости", ...)
 * @returns {Element|null}
 */
function findSectionByLabel(container, label) {
  // Ищем все текстовые элементы
  var allElements = container.querySelectorAll('div, span');

  for (var i = 0; i < allElements.length; i++) {
    var el = allElements[i];
    var directText = getDirectTextContent(el).trim();

    if (directText === label) {
      // Нашли заголовок — возвращаем его родительский контейнер
      // Поднимаемся на 3-5 уровней вверх, чтобы захватить всю секцию
      var section = el;
      for (var up = 0; up < 5; up++) {
        if (section.parentElement) {
          section = section.parentElement;
        }
        // Останавливаемся если достигли достаточно большого контейнера
        if (section.children.length >= 2 && section.offsetHeight > 60) {
          return section;
        }
      }
      return section;
    }
  }

  return null;
}

/**
 * Возвращает только прямой текст элемента (без текста дочерних элементов).
 */
function getDirectTextContent(element) {
  var text = '';
  for (var i = 0; i < element.childNodes.length; i++) {
    if (element.childNodes[i].nodeType === 3) { // TEXT_NODE
      text += element.childNodes[i].textContent;
    }
  }
  return text;
}

// ─── Контейнер и кнопка ───────────────────────────────────────

/** Находит контейнер бронирования на странице. */
function findBookingContainer() {
  if (!isBookingPage()) {
    return null;
  }
  return document.getElementById('MainPageTopBar') || null;
}

/**
 * Находит точку вставки кнопки.
 * Вставляем рядом с «Другие действия» в шапке бронирования.
 */
function findButtonInsertionPoint(container) {
  // Ищем ссылку/кнопку «Другие действия» и вставляем рядом
  var links = container.querySelectorAll('a, button, span');
  for (var i = 0; i < links.length; i++) {
    var t = (links[i].textContent || '').trim();
    if (t === 'Другие действия') {
      return links[i].closest('div[style]') || links[i].parentElement;
    }
  }

  // Фоллбэк: ищем «Редактировать бронирование»
  for (var j = 0; j < links.length; j++) {
    var t2 = (links[j].textContent || '').trim();
    if (t2 === 'Редактировать бронирование') {
      return links[j].closest('div') || links[j].parentElement;
    }
  }

  return null;
}

// ─── Общие утилиты ────────────────────────────────────────────

/**
 * Парсит цену из строки.
 * "47 700" → 47700, "15\u00a0000" → 15000
 */
function parsePrice(priceStr) {
  if (!priceStr) {
    return 0;
  }
  var cleaned = priceStr.replace(/[^\d.,]/g, '');
  if (/,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }
  var price = parseFloat(cleaned);
  return isNaN(price) ? 0 : Math.round(price);
}

/** Рассчитывает количество ночей между двумя датами. */
function calculateNights(checkInStr, checkOutStr) {
  if (!checkInStr || !checkOutStr) {
    return 0;
  }
  var d1 = parseDate(checkInStr);
  var d2 = parseDate(checkOutStr);
  if (!d1 || !d2) {
    return 0;
  }
  var nights = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return nights > 0 ? nights : 0;
}

/** Парсит дату из строки DD.MM.YYYY. */
function parseDate(str) {
  if (!str) {
    return null;
  }
  str = str.trim();
  var m = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }
  var d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Расчёт скидки ────────────────────────────────────────────

/**
 * Определяет процент скидки по количеству ночей:
 *  - до 3 ночей  → 0%
 *  - 4–5 ночей   → 5%
 *  - 6+ ночей    → 8%
 */
function calculateDiscount(nightsCount) {
  if (nightsCount >= 6) {
    return 8;
  }
  if (nightsCount >= 4) {
    return 5;
  }
  return 0;
}
