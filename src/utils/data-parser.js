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
 *  - Предоплата = сумма первых 3 суток (из тултипа/модального окна с ценами по дням)
 *  - Фоллбэк: (общая сумма / кол. ночей) × 3 (если посуточные цены недоступны)
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

  // 8. Телефон гостя — ищем в секции «Информация», чтобы не спутать с номером бронирования
  var guestPhone = parseGuestPhone(container, pageText);

  // 9. Оплаченная сумма и долг
  var paidAmount = parsePaidAmount(container, pageText);
  var debtAmount = parseDebtAmount(container, pageText);

  // 10. Количество гостей
  var guestCount = parseGuestCount(container);

  // 11. Время заезда и выезда
  var checkTimes = parseCheckTimes(pageText);

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

  // Предоплата = сумма первых 3 суток (из тултипа, если доступен)
  // Фоллбэк: (общая сумма / кол. ночей) × 3
  // content.js переопределит prepayAmount при наличии кешированных посуточных цен
  var dailyRatesData = parseDailyRatesFromTooltip();
  var dailyRates = dailyRatesData.rates || dailyRatesData; // поддержка старого формата
  var prepayAmount = 0;
  if (dailyRates.length > 0) {
    var daysForPrepay = Math.min(3, dailyRates.length);
    for (var dp = 0; dp < daysForPrepay; dp++) {
      prepayAmount += dailyRates[dp];
    }
  } else {
    prepayAmount = nightsCount > 0
      ? Math.round((totalPrice / nightsCount) * 3)
      : 0;
  }
  if (prepayAmount > totalPrice) {
    prepayAmount = totalPrice;
  }

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
    checkInTime: checkTimes.checkInTime || '',
    checkOutTime: checkTimes.checkOutTime || '',
    roomType: roomDesc,
    totalPrice: totalPrice,
    paidAmount: paidAmount,
    debtAmount: debtAmount,
    guestCount: guestCount,
    bookingNumber: bookingNumber || '',
    nightsCount: nightsCount,
    nightlyRate: nightlyRate,
    prepayAmount: prepayAmount,
    dailyRates: dailyRates,
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

/** Извлекает номер бронирования (форматы OTL-XXXXXXX, IMP-XXXXX и т.д.). */
function parseBookingNumber(text) {
  // Формат OTL-0000000015
  var otlMatch = text.match(/OTL-\d+/);
  if (otlMatch) return otlMatch[0];

  // Формат IMP-BLBLA120226 и другие: БУКВЫ-БУКВО-ЦИФРОВОЙ перед двоеточием
  var genericMatch = text.match(/([A-Z]{2,}-[A-Za-z0-9]{3,})(?=\s*:)/);
  if (genericMatch) return genericMatch[1];

  return null;
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
  // Приоритет №1: ищем полное название категории с корпусом в скобках
  // Ищем паттерны: "(Остров-2)", "(Остров-1)", "(Главный корпус)", "(Коттедж)"
  var allElements = container.querySelectorAll('*');
  for (var i = 0; i < allElements.length; i++) {
    var el = allElements[i];
    // Проверяем textContent и title атрибут
    var t = (el.textContent || '').trim();
    var titleAttr = el.getAttribute('title') || '';
    
    // Сначала проверяем title — там может быть полное название
    if (titleAttr && titleAttr.length > 10 && titleAttr.length < 150 &&
        titleAttr.match(/\(Остров-[12]\)|\(Главный корпус\)|\(Коттедж\)/) &&
        titleAttr.match(/[а-яА-ЯёЁ]/)) {
      console.log('[KonturPrepay] Найдено полное название в title:', titleAttr);
      return titleAttr;
    }
    
    // Затем проверяем textContent
    if (t && t.length > 10 && t.length < 150 &&
        t.match(/\(Остров-[12]\)|\(Главный корпус\)|\(Коттедж\)/) &&
        t.match(/[а-яА-ЯёЁ]/) &&
        !t.match(/оплат|внести|гости|информация|плательщик/i)) {
      // Извлекаем только название категории (до скобки с корпусом включительно)
      var match = t.match(/^([а-яА-ЯёЁ0-9\s\-\(\)"",.]+\(Остров-[12]\)|[а-яА-ЯёЁ0-9\s\-\(\)"",.]+\(Главный корпус\)|[а-яА-ЯёЁ0-9\s\-\(\)"",.]+\(Коттедж\))/);
      if (match) {
        console.log('[KonturPrepay] Найдено полное название в textContent:', match[1]);
        return match[1];
      }
      console.log('[KonturPrepay] Найдено название в textContent (полный текст):', t);
      return t;
    }
  }

  // Приоритет №2: ищем элемент с классом .a6zV6A (контейнер названия категории номера)
  // Это самый надёжный способ — Контур использует этот класс для заголовка категории
  var roomTypeElement = container.querySelector('.a6zV6A');
  if (roomTypeElement) {
    var t = (roomTypeElement.textContent || '').trim();
    var titleAttr = roomTypeElement.getAttribute('title') || '';
    
    // Проверяем title атрибут
    if (titleAttr && titleAttr.length > 10 && titleAttr.length < 150 &&
        titleAttr.match(/\(Остров-[12]\)|\(Главный корпус\)|\(Коттедж\)/)) {
      console.log('[KonturPrepay] Найдено полное название в title .a6zV6A:', titleAttr);
      return titleAttr;
    }
    
    if (t && t.length > 3 && t.length < 150 &&
        !t.match(/оплат|внести|гости|информация|плательщик/i) &&
        t.match(/[а-яА-ЯёЁ]/)) {
      // Извлекаем только название категории (до скобки с корпусом включительно)
      var match = t.match(/^([а-яА-ЯёЁ0-9\s\-\(\)"",.]+\(Остров-[12]\)|[а-яА-ЯёЁ0-9\s\-\(\)"",.]+\(Главный корпус\)|[а-яА-ЯёЁ0-9\s\-\(\)"",.]+\(Коттедж\))/);
      if (match) {
        console.log('[KonturPrepay] Найдено название в .a6zV6A (обрезанное):', match[1]);
        return match[1];
      }
      console.log('[KonturPrepay] Найдено название в .a6zV6A:', t);
      return t;
    }
  }

  // Приоритет №3: ищем по структуре DOM (div с названием категории)
  // Увеличили лимит длины с 60 до 150 символов для длинных названий с корпусом
  var allDivs = container.querySelectorAll('div');
  for (var i = 0; i < allDivs.length; i++) {
    var div = allDivs[i];
    var t = (div.textContent || '').trim();
    // Ищем div который содержит ТОЛЬКО название категории
    // (не содержит "Оплата", номера, дат и т.д.)
    if (div.children.length === 0 || (div.children.length === 1 && div.children[0].tagName === 'SPAN')) {
      if (t && t.length > 3 && t.length < 150 &&
          !t.match(/\d/) &&
          !t.match(/оплат|внести|гости|информация|плательщик|комментарий|задачи|услуги|история|расчет|бронирование/i) &&
          !t.match(/₽|руб|долг|тариф|заселить|заселен|подтвержд|отправить|скачать|редактировать|добавить|другие|помощь|настройки/i) &&
          !t.match(/@|http|OTL/) &&
          t.match(/[а-яА-ЯёЁ]/) &&
          div.closest('[data-oid="MainPageTab"]') === null) {
        // Проверяем, что этот элемент находится в области деталей номера
        // Поднимаемся до 5 уровней вверх по DOM, ищем номер комнаты рядом
        var ancestor = div;
        for (var up = 0; up < 5; up++) {
          if (ancestor.parentElement) {
            ancestor = ancestor.parentElement;
          }
          var ancestorText = ancestor.textContent || '';
          if (ancestorText.match(/\b\d{1,3}\b/) && ancestorText.length < 500) {
            console.log('[KonturPrepay] Найдено название в структуре DOM:', t);
            return t;
          }
        }
      }
    }
  }

  // Фоллбэк: ищем элемент, текст которого похож на название категории
  // и находится перед номером комнаты. Увеличили лимит с 100 до 150 символов
  var spans = container.querySelectorAll('span');
  for (var j = 0; j < spans.length; j++) {
    var span = spans[j];
    var st = (span.textContent || '').trim();
    if (st && st.length > 5 && st.length < 150 &&
        !st.match(/\d/) &&
        !st.match(/оплат|внести/i) &&
        st.match(/номер|люкс|стандарт|комфорт|эконом|студия|сюит|апартамент|полулюкс|двух|одно|трёх|четырёх|семейн|делюкс/i)) {
      console.log('[KonturPrepay] Найдено название в фоллбэке:', st);
      return st;
    }
  }

  console.log('[KonturPrepay] Не удалось найти название категории номера');
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

/** Извлекает имя заказчика из секции «Информация». */
function parseGuestName(container) {
  // Приоритет №1: ищем в секции «Информация» — первый элемент с иконкой человека
  // Берём ТОЛЬКО текст из .rkW8Ki (реквизиты или ФИО), игнорируем телефон/email
  var infoSection = findSectionByLabel(container, 'Информация');
  if (infoSection) {
    // Ищем элементы с иконкой человека (svg с характерным path)
    var allElements = infoSection.querySelectorAll('div, span');
    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      var svg = el.querySelector('svg');
      if (svg) {
        var svgHtml = svg.innerHTML || '';
        // Иконка человека из секции Информация: path с "M10 2a4.499" или "M10 2.002a4.532"
        if (svgHtml.indexOf('M10 2a4.499') !== -1 ||
            svgHtml.indexOf('M10 2.002a4.532') !== -1 ||
            svgHtml.indexOf('4.499 4.499 0 1 0') !== -1 ||
            svgHtml.indexOf('4.5 4.5 0 1 0') !== -1) {
          // Нашли иконку — извлекаем ТОЛЬКО текст из .rkW8Ki
          var parent = el.closest('div');
          if (parent) {
            // Ищем ТОЛЬКО .rkW8Ki — это реквизиты заказчика
            var textEl = parent.querySelector('.rkW8Ki');
            if (textEl) {
              var text = (textEl.textContent || '').trim();
              // Исключаем технические тексты
              if (text &&
                  text.length > 5 &&
                  text.indexOf('Стойка') === -1 &&
                  text.indexOf('администратора') === -1) {
                return text.replace(/\s+/g, ' ').trim();
              }
            }
          }
        }
      }
    }

    // Фоллбэк: ищем .rkW8Ki в секции Информация без привязки к иконке
    var rkW8KiEl = infoSection.querySelector('.rkW8Ki');
    if (rkW8KiEl) {
      var text = (rkW8KiEl.textContent || '').trim();
      if (text &&
          text.length > 5 &&
          text.indexOf('Стойка') === -1 &&
          text.indexOf('администратора') === -1) {
        return text.replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Приоритет №2: ищем в секции «Гости» — только если не нашли в Информация
  // Это нужно для случаев когда организация не указана в Информация
  var guestsSection = findSectionByLabel(container, 'Гости');
  if (guestsSection) {
    // Ищем карточки гостей: div с иконкой человека
    var guestCards = guestsSection.querySelectorAll('div');
    for (var c = 0; c < guestCards.length; c++) {
      var card = guestCards[c];
      var cardText = (card.textContent || '').trim();

      // Пропускаем заголовки «Гости», «Гость N»
      if (cardText === 'Гости' || cardText.match(/^Гость\s+\d+$/)) {
        continue;
      }

      // Ищем иконку человека (svg с характерным path)
      var svg = card.querySelector('svg');
      if (svg) {
        var svgHtml = svg.innerHTML || '';
        // Иконка взрослого: path с "M10 2.002a4.532" или "M8 1.25a2.75"
        // Иконка человека с руками: "1.325 3.24"
        // Иконка с "4.5 4.5 0 1 0"
        if (svgHtml.indexOf('M10 2.002a4.532') !== -1 ||
            svgHtml.indexOf('M8 1.25a2.75') !== -1 ||
            svgHtml.indexOf('1.325 3.24') !== -1 ||
            svgHtml.indexOf('4.5 4.5 0 1 0') !== -1) {
          // Нашли иконку человека — извлекаем полный текст из карточки
          // Исключаем только заголовки, технические тексты и возраст детей
          if (cardText &&
              cardText.length > 5 &&
              cardText.indexOf('Заселить') === -1 &&
              cardText.indexOf('Выселить') === -1 &&
              cardText.indexOf('Гость') !== 0 &&
              !cardText.match(/^\d+\s*лет/)) { // исключаем возраст детей
            // Очищаем текст от лишних пробелов и переносов
            var cleanText = cardText.replace(/\s+/g, ' ').trim();
            if (cleanText.length > 2) {
              return cleanText;
            }
          }
        }
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
function parseGuestPhone(container, text) {
  // Ищем в секции «Информация» (рядом с ФИО и email), чтобы не спутать
  // с цифрами номера бронирования (OTL-0000000024 и т.п.)
  var infoSection = findSectionByLabel(container, 'Информация');
  var searchText = infoSection ? (infoSection.textContent || '') : text;

  // Сначала ищем российский формат: +7, 8, 7 в начале
  var ruPhoneMatch = searchText.match(/(\+7|8|7)\s*[\(\s]*\d{3}[\)\s]*\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
  if (ruPhoneMatch) {
    return ruPhoneMatch[0].replace(/\s+/g, '').trim();
  }

  // Фоллбэк: любой номер в формате +цифры (международный)
  var intlMatch = searchText.match(/\+[\d\s()-]{10,}/);
  if (intlMatch) {
    return intlMatch[0].replace(/\s+/g, ' ').trim();
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

// ─── Парсеры оплаты и дополнительных данных ───────────────────

/** Извлекает оплаченную сумму из секции «Оплата». Паттерн: "25 000 ₽ оплачено". */
function parsePaidAmount(container, text) {
  var paymentSection = findSectionByLabel(container, 'Оплата');

  // Сначала ищем в секции «Оплата»
  if (paymentSection) {
    var sectionText = paymentSection.textContent || '';
    var match = sectionText.match(/([\d\s\u00a0]+)\s*₽[^а-яА-ЯёЁ]*оплачено/);
    if (match) {
      return parsePrice(match[1]);
    }
  }

  // Фоллбэк: ищем во всём тексте страницы
  var fallback = text.match(/([\d\s\u00a0]+)\s*₽[^а-яА-ЯёЁ]*оплачено/);
  if (fallback) {
    return parsePrice(fallback[1]);
  }
  return 0;
}

/** Извлекает сумму долга из секции «Оплата». Паттерн: "22 700 ₽ долг". */
function parseDebtAmount(container, text) {
  var paymentSection = findSectionByLabel(container, 'Оплата');

  // Сначала ищем в секции «Оплата»
  if (paymentSection) {
    var sectionText = paymentSection.textContent || '';
    var match = sectionText.match(/([\d\s\u00a0]+)\s*₽[^а-яА-ЯёЁ]*долг/);
    if (match) {
      return parsePrice(match[1]);
    }
  }

  // Фоллбэк: ищем во всём тексте страницы
  var fallback = text.match(/([\d\s\u00a0]+)\s*₽[^а-яА-ЯёЁ]*долг/);
  if (fallback) {
    return parsePrice(fallback[1]);
  }
  return 0;
}

/**
 * Извлекает количество гостей из секции «Гости».
 *
 * Контур Отель отображает гостей так:
 *   «Гости  2[adult-icon]  1[child-icon] 7 лет»
 * textContent склеивается в «Гости217 лет», поэтому парсим по DOM-структуре:
 *   1. (приоритет) Извлекаем числа из сводки рядом с заголовком «Гости»:
 *      div > span(число) + span(svg-иконка взрослого / ребёнка)
 *   2. (фоллбэк) Считаем карточки «Гость N» + именные карточки
 *   3. Извлекаем возрасты детей из элементов data-tid="Age_N"
 *
 * @returns {{ adults: number, children: number, childrenAges: number[], total: number, text: string }}
 */
function parseGuestCount(container) {
  var result = { adults: 0, children: 0, childrenAges: [], total: 0, text: '' };

  var guestsSection = findSectionByLabel(container, 'Гости');
  if (!guestsSection) return result;

  // Извлекаем возрасты детей из data-tid="Age_N"
  var ageElements = guestsSection.querySelectorAll('[data-tid^="Age_"]');
  for (var i = 0; i < ageElements.length; i++) {
    var ageText = (ageElements[i].textContent || '').trim();
    var age = parseInt(ageText, 10);
    if (!isNaN(age) && age >= 0 && age < 18) {
      result.childrenAges.push(age);
    }
  }

  // Способ 1 (приоритетный): извлекаем из сводки «2 [adult-icon] 1 [child-icon]»
  // Ищем div-ы: span(число) + span(svg-иконка)
  var summaryDivs = guestsSection.querySelectorAll('div');
  for (var s = 0; s < summaryDivs.length; s++) {
    var div = summaryDivs[s];
    if (div.children.length === 2 &&
        div.children[0].tagName === 'SPAN' &&
        div.children[1].tagName === 'SPAN' &&
        div.children[1].querySelector &&
        div.children[1].querySelector('svg')) {
      var numText = (div.children[0].textContent || '').trim();
      var num = parseInt(numText, 10);
      if (!isNaN(num) && num > 0 && num < 100) {
        // Определяем тип по SVG-иконке: ребёнок имеет характерные path-фрагменты
        var svgHtml = div.children[1].innerHTML || '';
        // Иконка ребёнка 16×16: "1.854 3.646" (фигура с руками), "M8 1.25a2.75" (маленькая голова)
        // Иконка ребёнка 20×20: "1.325 3.24", "M10 .5a3.563" (спортивная фигура)
        if (svgHtml.indexOf('1.854 3.646') !== -1 ||
            svgHtml.indexOf('M8 1.25a2.75') !== -1 ||
            svgHtml.indexOf('1.325 3.24') !== -1 ||
            svgHtml.indexOf('M10 .5a3.563') !== -1) {
          result.children += num;
        } else {
          result.adults += num;
        }
      }
    }
  }

  if (result.adults > 0 || result.children > 0) {
    result.total = result.adults + result.children;
  }

  // Способ 2 (фоллбэк): считаем карточки гостей по DOM
  if (result.total === 0) {
    var sectionText = guestsSection.textContent || '';
    // Считаем «Гость N» (неименные)
    var guestEntries = sectionText.match(/Гость\s+\d+/g);
    var unnamedCount = guestEntries ? guestEntries.length : 0;

    // Считаем именные карточки (ФИО — кириллические слова рядом с «Заселить» / кнопками)
    var namedCount = 0;
    var guestCards = guestsSection.querySelectorAll('div');
    for (var c = 0; c < guestCards.length; c++) {
      var cardDiv = guestCards[c];
      var cardText = (cardDiv.textContent || '').trim();
      // Карточка с «Заселить» или «Выселить» и ФИО внутри — именной гость
      if ((cardText.indexOf('Заселить') !== -1 || cardText.indexOf('Выселить') !== -1 ||
           cardText.indexOf('Заселен') !== -1) &&
          cardText.match(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/) &&
          cardDiv.querySelector('svg') &&
          cardText.indexOf('Гость') === -1) {
        namedCount++;
        break; // первый именной — основной гость
      }
    }

    result.total = unnamedCount + namedCount;
    result.children = result.childrenAges.length;
    result.adults = Math.max(0, result.total - result.children);
  }

  // Формируем читаемый текст
  var parts = [];
  if (result.adults > 0) {
    parts.push(result.adults + ' ' + pluralize(result.adults, 'взрослый', 'взрослых', 'взрослых'));
  }
  if (result.children > 0) {
    var childStr = result.children + ' ' +
      pluralize(result.children, 'ребёнок', 'ребёнка', 'детей');
    if (result.childrenAges.length > 0) {
      var ageStrs = [];
      for (var a = 0; a < result.childrenAges.length; a++) {
        var ag = result.childrenAges[a];
        ageStrs.push(ag + ' ' + pluralize(ag, 'год', 'года', 'лет'));
      }
      childStr += ' (' + ageStrs.join(', ') + ')';
    }
    parts.push(childStr);
  }
  result.text = parts.join(', ');

  return result;
}

/** Склонение существительных: 1 гость, 2 гостя, 5 гостей */
function pluralize(n, one, few, many) {
  var abs = Math.abs(n) % 100;
  var lastDigit = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (lastDigit === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4) return few;
  return many;
}

/** Извлекает время заезда и выезда (HH:MM). */
function parseCheckTimes(text) {
  // Ищем два последовательных времени в формате HH:MM (двузначный час)
  var match = text.match(/(\d{2}:\d{2})\s*(\d{2}:\d{2})/);
  if (match) {
    return {
      checkInTime: match[1],
      checkOutTime: match[2]
    };
  }
  return { checkInTime: null, checkOutTime: null };
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
      for (var up = 0; up < 8; up++) {
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

// ─── Парсинг модального окна бронирования ──────────────────────

/**
 * Парсит данные из модального окна создания/редактирования бронирования.
 * Предоплата = сумма первых 3 суток (из посуточных цен модального окна).
 * Фоллбэк: (общая сумма / кол. ночей) × 3.
 *
 * @param {Element} modalRoot — корневой элемент модального окна (или document для поиска)
 * @returns {{ totalPrice: number, nightsCount: number, prepayAmount: number, dailyRates: number[] }|null}
 */
function parseBookingModalData(modalRoot) {
  var root = modalRoot || document;
  var text = (root.textContent || '');

  // 1. Сумма итого — читаем из инпута «Стоимость» (CurrencyInput рядом с label "Стоимость")
  var totalPrice = 0;
  var costLabel = findElementByText(root, 'Стоимость');
  if (costLabel) {
    var costContainer = costLabel.closest('div');
    if (costContainer && costContainer.parentElement) {
      var costInputs = costContainer.parentElement.querySelectorAll('input[inputmode="decimal"], input[type="text"]');
      for (var ci = 0; ci < costInputs.length; ci++) {
        var costVal = parsePrice(costInputs[ci].value || '');
        if (costVal >= 1000) {
          totalPrice = costVal;
          break;
        }
      }
    }
  }

  // Фоллбэк: ищем "ЧИСЛО ₽" в блоке "Итого за проживание"
  // ВАЖНО: исключаем наш собственный блок #kontur-prepay-modal-block,
  // чтобы его текст не влиял на парсинг (иначе замкнутый цикл)
  if (totalPrice <= 0) {
    var totalBlock = findElementByTextContains(root, 'Итого за проживание');
    if (totalBlock) {
      var section = totalBlock.closest('div[data-tid="Gapped__vertical"]') ||
        totalBlock.closest('div[data-tid="Gapped__horizontal"]') ||
        totalBlock.closest('div');
      var prepayBlock = root.querySelector('#kontur-prepay-modal-block');
      while (section && section !== root) {
        var blockText = section.textContent || '';
        // Вырезаем текст нашего блока предоплаты, чтобы он не засорял парсинг
        if (prepayBlock && section.contains(prepayBlock)) {
          blockText = blockText.replace(prepayBlock.textContent || '', '');
        }
        if (blockText.indexOf('₽') !== -1) {
          var allPrices = blockText.match(/([\d\s\u00a0]+)\s*₽/g);
          if (allPrices) {
            for (var pi = 0; pi < allPrices.length; pi++) {
              var p = parsePrice(allPrices[pi]);
              if (p >= 1000 && p > totalPrice) {
                totalPrice = p;
              }
            }
            if (totalPrice > 0) break;
          }
        }
        section = section.parentElement;
      }
    }
  }

  // 2. Количество ночей — из input рядом с "Ночей" или из дат
  var nightsCount = 0;
  var nightsLabel = findElementByText(root, 'Ночей');
  if (nightsLabel) {
    var nightsParent = nightsLabel.closest('div');
    var container = nightsParent ? nightsParent.parentElement : null;
    if (container) {
      var inputs = container.querySelectorAll('input[type="text"], input[inputmode="decimal"]');
      for (var j = 0; j < inputs.length; j++) {
        var val = parseInt((inputs[j].value || '').trim(), 10);
        if (!isNaN(val) && val >= 1 && val <= 365) {
          nightsCount = val;
          break;
        }
      }
    }
  }

  // 3. Если ночей не нашли — считаем по датам
  if (nightsCount <= 0) {
    var hiddenInputs = root.querySelectorAll('input[type="hidden"][data-tid="InputLikeText__nativeInput"]');
    var dateValues = [];
    for (var k = 0; k < hiddenInputs.length; k++) {
      var v = (hiddenInputs[k].value || '').trim();
      if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(v)) {
        dateValues.push(v);
      }
    }
    if (dateValues.length >= 2) {
      nightsCount = calculateNights(dateValues[0], dateValues[1]);
    }
  }

  if (totalPrice <= 0 || nightsCount <= 0) {
    return null;
  }

  var nightlyRate = nightsCount > 0 ? Math.round(totalPrice / nightsCount) : 0;

  // Предоплата = сумма первых 3 суток (из модального окна)
  var dailyRatesData = parseDailyRatesFromElement(root);
  var dailyRates = dailyRatesData.rates || dailyRatesData; // поддержка старого формата
  var prepayAmount = 0;
  if (dailyRates.length > 0) {
    var daysForPrepay = Math.min(3, dailyRates.length);
    for (var dp = 0; dp < daysForPrepay; dp++) {
      prepayAmount += dailyRates[dp];
    }
  } else {
    // Фоллбэк: (общая сумма / кол. ночей) × 3
    prepayAmount = nightsCount > 0
      ? Math.round((totalPrice / nightsCount) * 3)
      : 0;
  }
  if (prepayAmount > totalPrice) {
    prepayAmount = totalPrice;
  }

  return {
    totalPrice: totalPrice,
    nightsCount: nightsCount,
    prepayAmount: prepayAmount,
    dailyRates: dailyRates
  };
}

// ─── Парсинг посуточных цен (тултип / модальное окно) ────────

/**
 * Извлекает посуточные цены из DOM-элемента (тултипа или модального окна).
 *
 * Ищет строки с номером дня (1, 2, 3, ...) и ценой (title="15 900₽").
 * Строки «Итого за проживание» пропускаются.
 *
 * @param {Element} root — корневой элемент для поиска
 * @returns {{ rates: number[], ratesWithDiscount: number[], totalPrice: number, totalPriceWithDiscount: number, discountPercent: number }} — массив цен по дням (в порядке номеров дней) + данные о скидке
 */
function parseDailyRatesFromElement(root) {
  if (!root) return { rates: [], ratesWithDiscount: [], totalPrice: 0, totalPriceWithDiscount: 0, discountPercent: 0 };

  var rates = [];
  var ratesWithDiscount = [];
  var spans = root.querySelectorAll('span');

  for (var i = 0; i < spans.length; i++) {
    var span = spans[i];
    var text = (span.textContent || '').trim();

    // Ищем span с номером дня (1, 2, 3, ...)
    if (!/^\d{1,3}$/.test(text)) continue;
    if (span.children.length > 0) continue;

    var dayNum = parseInt(text, 10);
    if (dayNum < 1 || dayNum > 365) continue;

    // Поднимаемся по DOM, ищем строку содержащую и номер дня, и цены
    var row = span;
    var priceFound = 0;
    var priceWithDiscountFound = 0;

    for (var up = 0; up < 5; up++) {
      if (!row.parentElement || row.parentElement === root) break;
      row = row.parentElement;

      // Проверяем: не «Итого» ли это
      var rowText = row.textContent || '';
      if (rowText.indexOf('Итого') !== -1) break;

      // Ищем первую цену (без скидки) — класс Arsj11 или первый title с ₽
      var priceEl = row.querySelector('.Arsj11[title*="₽"]');
      if (priceEl) {
        var title = priceEl.getAttribute('title') || '';
        priceFound = parsePrice(title.replace('₽', ''));
      }

      // Ищем вторую цену (со скидкой) — класс k9mIu3
      var priceDiscountEl = row.querySelector('.k9mIu3[title*="₽"]');
      if (priceDiscountEl) {
        var titleDisc = priceDiscountEl.getAttribute('title') || '';
        priceWithDiscountFound = parsePrice(titleDisc.replace('₽', ''));
      }

      // Если нашли обе цены — выходим
      if (priceFound > 0 || priceWithDiscountFound > 0) {
        break;
      }
    }

    if (priceFound > 0 || priceWithDiscountFound > 0) {
      // Если цена без скидки не найдена, используем цену со скидкой
      rates.push({ day: dayNum, price: priceFound > 0 ? priceFound : priceWithDiscountFound });
      ratesWithDiscount.push({ day: dayNum, price: priceWithDiscountFound > 0 ? priceWithDiscountFound : priceFound });
    }
  }

  // Сортируем по номеру дня
  rates.sort(function (a, b) { return a.day - b.day; });
  ratesWithDiscount.sort(function (a, b) { return a.day - b.day; });

  // Убираем дубликаты и возвращаем только цены
  var result = [];
  var resultWithDiscount = [];
  var seen = {};
  for (var r = 0; r < rates.length; r++) {
    if (!seen[rates[r].day]) {
      result.push(rates[r].price);
      seen[rates[r].day] = true;
    }
  }
  for (var rd = 0; rd < ratesWithDiscount.length; rd++) {
    if (!seen[ratesWithDiscount[rd].day + '_d']) {
      resultWithDiscount.push(ratesWithDiscount[rd].price);
      seen[ratesWithDiscount[rd].day + '_d'] = true;
    }
  }

  // Считаем общую сумму и скидку
  var totalPrice = 0;
  for (var t = 0; t < result.length; t++) {
    totalPrice += result[t];
  }
  var totalPriceWithDiscount = 0;
  for (var td = 0; td < resultWithDiscount.length; td++) {
    totalPriceWithDiscount += resultWithDiscount[td];
  }

  var discountPercent = 0;
  if (totalPrice > 0 && totalPriceWithDiscount > 0 && totalPrice > totalPriceWithDiscount) {
    discountPercent = Math.round((totalPrice - totalPriceWithDiscount) * 100 / totalPrice);
  }

  return {
    rates: result,
    ratesWithDiscount: resultWithDiscount,
    totalPrice: totalPrice,
    totalPriceWithDiscount: totalPriceWithDiscount,
    discountPercent: discountPercent
  };
}

/**
 * Находит видимый тултип «Стоимость проживания» и извлекает из него посуточные цены.
 *
 * @returns {{ rates: number[], ratesWithDiscount: number[], totalPrice: number, totalPriceWithDiscount: number, discountPercent: number }} — данные о ценах и скидке
 */
function parseDailyRatesFromTooltip() {
  var tooltips = document.querySelectorAll('[data-tid="Tooltip__content"]');
  for (var i = 0; i < tooltips.length; i++) {
    var tooltip = tooltips[i];
    var text = tooltip.textContent || '';
    if (text.indexOf('Стоимость проживания') !== -1 || text.indexOf('Ночь') !== -1) {
      return parseDailyRatesFromElement(tooltip);
    }
  }
  return { rates: [], ratesWithDiscount: [], totalPrice: 0, totalPriceWithDiscount: 0, discountPercent: 0 };
}

/**
 * Извлекает процент скидки из тултипа «Стоимость проживания».
 * Ищет блок «Скидка» с процентом (например, «5%»).
 *
 * @returns {number} — процент скидки (0, если скидка не найдена)
 */
function parseDiscountFromTooltip() {
  var tooltips = document.querySelectorAll('[data-tid="Tooltip__content"]');
  for (var i = 0; i < tooltips.length; i++) {
    var tooltip = tooltips[i];
    var text = tooltip.textContent || '';
    if (text.indexOf('Стоимость проживания') === -1 && text.indexOf('Ночь') === -1) {
      continue;
    }

    // Ищем блок со скидкой: «Скидка» и рядом процент
    var discountLabel = findElementByTextContains(tooltip, 'Скидка');
    if (discountLabel) {
      // Поднимаемся вверх и ищем элемент с процентом (%)
      var parent = discountLabel.parentElement;
      for (var up = 0; up < 6; up++) {
        if (!parent) break;
        var percentMatch = parent.textContent.match(/(\d+)\s*%/);
        if (percentMatch) {
          return parseInt(percentMatch[1], 10);
        }
        parent = parent.parentElement;
      }
    }

    // Альтернативный поиск: ищем элемент с title="X%" или текстом «X%»
    var percentElements = tooltip.querySelectorAll('[title*="%"]');
    for (var j = 0; j < percentElements.length; j++) {
      var title = percentElements[j].getAttribute('title') || '';
      var m = title.match(/(\d+)\s*%/);
      if (m) {
        return parseInt(m[1], 10);
      }
    }
  }
  return 0;
}

/**
 * Находит элемент, содержащий точный текст (или дочерний с этим текстом).
 */
function findElementByText(root, text) {
  var all = root.querySelectorAll('span, div');
  for (var i = 0; i < all.length; i++) {
    var direct = getDirectTextContent(all[i]).trim();
    if (direct === text) {
      return all[i];
    }
    if ((all[i].textContent || '').trim() === text && all[i].children.length === 0) {
      return all[i];
    }
  }
  return null;
}

/**
 * Находит элемент, textContent которого содержит указанный подстрока.
 */
function findElementByTextContains(root, substring) {
  var all = root.querySelectorAll('span, div');
  for (var i = 0; i < all.length; i++) {
    var direct = getDirectTextContent(all[i]).trim();
    if (direct.indexOf(substring) !== -1) {
      return all[i];
    }
  }
  return null;
}

/**
 * Проверяет, является ли элемент модальным окном бронирования.
 */
function isBookingModal(element) {
  if (!element) return false;
  var header = element.querySelector('[data-tid="ModalHeader__root"]');
  if (header && (header.textContent || '').indexOf('Бронирование') !== -1) {
    return true;
  }
  return !!findElementByTextContains(element, 'Итого за проживание');
}
