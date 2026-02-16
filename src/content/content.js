/**
 * Content Script — главный модуль расширения.
 *
 * Запускается на hotel.kontur.ru и:
 *  1. Отслеживает SPA-навигацию и изменения DOM
 *  2. На странице бронирования добавляет кнопки:
 *     - «Скачать счёт» — генерирует PDF-счёт и скачивает
 *     - «Отправить счёт» — генерирует PDF-счёт и отправляет на email гостя
 *     - «Скачать подтверждение» — генерирует PDF подтверждения и скачивает
 *     - «Отправить подтверждение» — генерирует PDF подтверждения и отправляет на email
 *  3. В тултипе «Стоимость проживания» показывает сумму предоплаты (первые 3 суток)
 *  4. Кеширует посуточные цены из тултипа для расчёта предоплаты в счёте
 *  5. Показывает анимированную стрелку-подсказку на иконку «i» если цены не загружены
 *  6. Скрывает встроенный блок отправки подтверждения
 *  7. Удаляет пункт «Отправить подтверждение» из контекстного меню
 *
 * Зависимости (загружаются раньше через manifest.json content_scripts):
 *  - jspdf.umd.min.js         (глобальная jspdf)
 *  - qrcode.js                 (qrcode)
 *  - roboto-regular.js         (ROBOTO_FONT_BASE64)
 *  - hotel-details.js          (HOTEL_DETAILS)
 *  - data-parser.js            (parseBookingData, findBookingContainer, findButtonInsertionPoint, isBookingPage, parseDailyRatesFromElement, parseDailyRatesFromTooltip)
 *  - invoice-generator.js      (generateInvoicePDF)
 *  - confirmation-generator.js (generateConfirmationPDF)
 *  - email-sender.js           (sendInvoiceEmail, sendConfirmationEmail)
 */

(function () {
  'use strict';

  // ─── Константы ──────────────────────────────────────────────
  var WRAPPER_ID = 'kontur-prepay-wrapper';
  var BTN_DOWNLOAD_ID = 'kontur-prepay-download-btn';
  var BTN_SEND_ID = 'kontur-prepay-send-btn';

  var CONFIRM_WRAPPER_ID = 'kontur-confirm-wrapper';
  var BTN_CONFIRM_DOWNLOAD_ID = 'kontur-confirm-download-btn';
  var BTN_CONFIRM_SEND_ID = 'kontur-confirm-send-btn';

  var TOOLTIP_PREPAY_ID = 'kontur-tooltip-prepay';
  var ARROW_HINT_ID = 'kontur-arrow-hint';

  var OBSERVER_DEBOUNCE_MS = 500;
  var lastUrl = window.location.href;

  // Кеш посуточных цен (из тултипа «Стоимость проживания»)
  var cachedDailyRates = null;
  var arrowHintTimer = null;
  var tooltipRetryTimer = null;

  // ─── SVG-иконки ─────────────────────────────────────────────

  var DOWNLOAD_ICON =
    '<svg class="kontur-prepay-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/>' +
    '<line x1="12" y1="15" x2="12" y2="3"/>' +
    '</svg>';

  var SEND_ICON =
    '<svg class="kontur-prepay-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>' +
    '<polyline points="22,6 12,13 2,6"/>' +
    '</svg>';

  var CONFIRM_DOWNLOAD_ICON =
    '<svg class="kontur-confirm-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/>' +
    '<line x1="16" y1="13" x2="8" y2="13"/>' +
    '<line x1="16" y1="17" x2="8" y2="17"/>' +
    '<polyline points="10 9 9 9 8 9"/>' +
    '</svg>';

  var CONFIRM_SEND_ICON =
    '<svg class="kontur-confirm-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>' +
    '<polyline points="22,6 12,13 2,6"/>' +
    '</svg>';

  // ─── Утилиты ────────────────────────────────────────────────

  function showToast(message, type) {
    var existing = document.querySelector('.kontur-prepay-toast');
    if (existing) {
      existing.remove();
    }

    var toast = document.createElement('div');
    toast.className = 'kontur-prepay-toast kontur-prepay-toast--' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('kontur-prepay-toast--visible');
    });

    setTimeout(function () {
      toast.classList.remove('kontur-prepay-toast--visible');
      setTimeout(function () {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, 4000);
  }

  function setButtonState(button, state, text) {
    button.disabled = state === 'loading';

    var btnType = button.getAttribute('data-btn-type') || 'prepay';
    var isPrimary = button.getAttribute('data-variant') === 'primary';
    var baseClass = btnType === 'confirm' ? 'kontur-confirm-btn' : 'kontur-prepay-btn';
    var secondaryClass = baseClass + '--secondary';

    button.className = isPrimary ? baseClass : baseClass + ' ' + secondaryClass;

    if (state === 'loading') {
      button.classList.add(baseClass + '--loading');
    } else if (state === 'success') {
      button.classList.add(baseClass + '--success');
    } else if (state === 'error') {
      button.classList.add(baseClass + '--error');
    }

    if (text) {
      button.textContent = text;
    }
  }

  function downloadPDF(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(function () {
      URL.revokeObjectURL(url);
      link.remove();
    }, 1000);
  }

  function resetButtonAfterDelay(button, icon, label) {
    setTimeout(function () {
      setButtonState(button, 'idle');
      button.innerHTML = icon + ' ' + label;
    }, 3000);
  }

  // ─── Общий парсинг + генерация PDF ──────────────────────────

  /**
   * Парсит данные и генерирует PDF.
   * Возвращает { bookingData, pdfResult } или null при ошибке.
   */
  function prepareInvoice(button, icon, label) {
    // Пробуем получить посуточные цены из кеша или видимого тултипа
    if (!cachedDailyRates || cachedDailyRates.length === 0) {
      tryCaptureDailyRates();
    }

    if (!cachedDailyRates || cachedDailyRates.length === 0) {
      setButtonState(button, 'error', '❌ Нет цен по дням');
      showToast(
        'Наведите курсор на иконку ⓘ рядом со стоимостью, чтобы загрузить цены по дням, затем нажмите кнопку снова.',
        'error'
      );
      showArrowHint();
      resetButtonAfterDelay(button, icon, label);
      return null;
    }

    var bookingData = parseBookingData();

    if (!bookingData) {
      setButtonState(button, 'error', '❌ Ошибка парсинга');
      showToast('Не удалось прочитать данные бронирования.', 'error');
      resetButtonAfterDelay(button, icon, label);
      return null;
    }

    // Переопределяем предоплату на основе кешированных посуточных цен
    var prepay = 0;
    var daysForPrepay = Math.min(3, cachedDailyRates.length);
    for (var d = 0; d < daysForPrepay; d++) {
      prepay += cachedDailyRates[d];
    }
    if (prepay > bookingData.totalPrice) {
      prepay = bookingData.totalPrice;
    }
    bookingData.prepayAmount = prepay;
    bookingData.dailyRates = cachedDailyRates;

    var missingFields = validateBookingData(bookingData);
    if (missingFields.length > 0) {
      setButtonState(button, 'error', '❌ Не хватает данных');
      showToast('Не найдены поля: ' + missingFields.join(', '), 'error');
      resetButtonAfterDelay(button, icon, label);
      return null;
    }

    var pdfResult = generateInvoicePDF(bookingData, HOTEL_DETAILS);

    return { bookingData: bookingData, pdfResult: pdfResult };
  }

  function validateBookingData(data) {
    var required = [
      { key: 'guestName', label: 'ФИО гостя' },
      { key: 'guestEmail', label: 'Email гостя' },
      { key: 'checkIn', label: 'Дата заезда' },
      { key: 'checkOut', label: 'Дата выезда' },
      { key: 'totalPrice', label: 'Стоимость' }
    ];

    var missing = [];
    for (var i = 0; i < required.length; i++) {
      if (!data[required[i].key]) {
        missing.push(required[i].label);
      }
    }
    return missing;
  }

  // ─── Обработчик: Скачать счёт ──────────────────────────────

  function handleDownloadClick(event) {
    var button = event.currentTarget;
    setButtonState(button, 'loading', '⏳ Генерация...');

    try {
      var result = prepareInvoice(button, DOWNLOAD_ICON, 'Скачать счёт');
      if (!result) {
        return;
      }

      downloadPDF(result.pdfResult.blob, result.pdfResult.filename);

      setButtonState(button, 'success', '✅ Скачано');
      showToast('Счёт скачан: ' + result.pdfResult.filename, 'success');
      resetButtonAfterDelay(button, DOWNLOAD_ICON, 'Скачать счёт');
    } catch (error) {
      console.error('[KonturPrepay] Ошибка:', error);
      setButtonState(button, 'error', '❌ Ошибка');
      showToast('Ошибка: ' + error.message, 'error');
      resetButtonAfterDelay(button, DOWNLOAD_ICON, 'Скачать счёт');
    }
  }

  // ─── Обработчик: Отправить на email ─────────────────────────

  function handleSendClick(event) {
    var button = event.currentTarget;
    setButtonState(button, 'loading', '⏳ Отправка...');

    try {
      var result = prepareInvoice(button, SEND_ICON, 'Отправить на email');
      if (!result) {
        return;
      }

      var bookingData = result.bookingData;
      var pdfResult = result.pdfResult;

      var surchargeAtHotel = bookingData.totalPrice - bookingData.prepayAmount;
      if (surchargeAtHotel < 0) surchargeAtHotel = 0;

      var invoiceSubject = 'Счёт на предоплату — бронирование №' + bookingData.bookingNumber;
      var invoiceBody =
        'Здравствуйте!\n\n' +
        'Для вас забронирован номер: ' + (bookingData.roomType || '') + '\n\n' +
        'Всего к оплате: ' + formatMoney(bookingData.totalPrice) + ' руб.\n' +
        'Предоплата по бронированию: ' + formatMoney(bookingData.prepayAmount) + ' руб.\n' +
        'К оплате в отеле: ' + formatMoney(surchargeAtHotel) + ' руб.\n\n' +
        'Вы можете произвести предоплату следующими способами:\n' +
        '\u2022 используя счет на предоплату (во вложении);\n' +
        '\u2022 просканировав QR-код счета через банковское приложение с телефона.\n' +
        'Оплатить необходимо в течение 3 (трех) суток с момента бронирования*.\n' +
        'После того, как денежные средства поступят на наш расчетный счет, ' +
        'бронирование будет подтверждено, и мы направим вам ваучер.\n' +
        '* Если оплата по счету не будет произведена в течение 3 суток, бронь аннулируется.\n\n' +
        'Спасибо, что выбрали нас, «Альбатрос» ждёт Вас!\n' +
        '__\n' +
        'С уважением, отдел бронирования ГРК «Альбатрос»\n' +
        'Официальный сайт: https://albatrosmore.ru/\n' +
        ' 8 (800) 101-47-17\n' +
        ' 8 (861) 213-21-17\n\n' +
        'Альбатрос — место, куда возвращаются за счастьем';

      sendInvoiceEmail(
        {
          to: bookingData.guestEmail,
          guestName: bookingData.guestName,
          bookingNumber: bookingData.bookingNumber,
          pdfBase64: pdfResult.base64,
          pdfFilename: pdfResult.filename,
          emailSubject: invoiceSubject,
          emailBody: invoiceBody
        },
        function onSuccess() {
          setButtonState(button, 'success', '✅ Отправлено');
          showToast('Счёт отправлен на ' + bookingData.guestEmail, 'success');
          resetButtonAfterDelay(button, SEND_ICON, 'Отправить на email');
        },
        function onError(errorMessage) {
          setButtonState(button, 'error', '❌ Ошибка');
          showToast('Ошибка отправки: ' + errorMessage, 'error');
          resetButtonAfterDelay(button, SEND_ICON, 'Отправить на email');
        }
      );
    } catch (error) {
      console.error('[KonturPrepay] Ошибка:', error);
      setButtonState(button, 'error', '❌ Ошибка');
      showToast('Ошибка: ' + error.message, 'error');
      resetButtonAfterDelay(button, SEND_ICON, 'Отправить на email');
    }
  }

  // ─── Подготовка подтверждения бронирования ──────────────────

  /**
   * Парсит данные и генерирует PDF подтверждения.
   * Возвращает { bookingData, pdfResult } или null при ошибке.
   */
  function prepareConfirmation(button, icon, label) {
    var bookingData = parseBookingData();

    if (!bookingData) {
      setButtonState(button, 'error', '❌ Ошибка парсинга');
      showToast('Не удалось прочитать данные бронирования.', 'error');
      resetButtonAfterDelay(button, icon, label);
      return null;
    }

    // Для подтверждения нужен минимальный набор полей
    var missing = [];
    if (!bookingData.guestName) missing.push('ФИО гостя');
    if (!bookingData.checkIn) missing.push('Дата заезда');
    if (!bookingData.checkOut) missing.push('Дата выезда');
    if (!bookingData.totalPrice) missing.push('Стоимость');

    if (missing.length > 0) {
      setButtonState(button, 'error', '❌ Не хватает данных');
      showToast('Не найдены поля: ' + missing.join(', '), 'error');
      resetButtonAfterDelay(button, icon, label);
      return null;
    }

    var pdfResult = generateConfirmationPDF(bookingData, HOTEL_DETAILS);

    return { bookingData: bookingData, pdfResult: pdfResult };
  }

  // ─── Обработчик: Скачать подтверждение ─────────────────────

  function handleConfirmDownloadClick(event) {
    var button = event.currentTarget;
    setButtonState(button, 'loading', '⏳ Генерация...');

    try {
      var result = prepareConfirmation(button, CONFIRM_DOWNLOAD_ICON, 'Скачать подтверждение');
      if (!result) {
        return;
      }

      downloadPDF(result.pdfResult.blob, result.pdfResult.filename);

      setButtonState(button, 'success', '✅ Скачано');
      showToast('Подтверждение скачано: ' + result.pdfResult.filename, 'success');
      resetButtonAfterDelay(button, CONFIRM_DOWNLOAD_ICON, 'Скачать подтверждение');
    } catch (error) {
      console.error('[KonturPrepay] Ошибка:', error);
      setButtonState(button, 'error', '❌ Ошибка');
      showToast('Ошибка: ' + error.message, 'error');
      resetButtonAfterDelay(button, CONFIRM_DOWNLOAD_ICON, 'Скачать подтверждение');
    }
  }

  // ─── Обработчик: Отправить подтверждение ───────────────────

  function handleConfirmSendClick(event) {
    var button = event.currentTarget;
    setButtonState(button, 'loading', '⏳ Отправка...');

    try {
      var result = prepareConfirmation(button, CONFIRM_SEND_ICON, 'Отправить подтверждение');
      if (!result) {
        return;
      }

      var bookingData = result.bookingData;

      // Проверка внесённой суммы: подтверждение отправляется только при предоплате
      var paidAmount = bookingData.paidAmount || 0;
      if (paidAmount <= 0) {
        setButtonState(button, 'error', '❌ Ошибка');
        showToast('Подтверждение может быть отправлено только при внесении предоплаты', 'error');
        resetButtonAfterDelay(button, CONFIRM_SEND_ICON, 'Отправить подтверждение');
        return;
      }
      var pdfResult = result.pdfResult;

      sendConfirmationEmail(
        {
          to: bookingData.guestEmail,
          guestName: bookingData.guestName,
          bookingNumber: bookingData.bookingNumber,
          pdfBase64: pdfResult.base64,
          pdfFilename: pdfResult.filename
        },
        function onSuccess() {
          setButtonState(button, 'success', '✅ Отправлено');
          showToast('Подтверждение отправлено на ' + bookingData.guestEmail, 'success');
          resetButtonAfterDelay(button, CONFIRM_SEND_ICON, 'Отправить подтверждение');
        },
        function onError(errorMessage) {
          setButtonState(button, 'error', '❌ Ошибка');
          showToast('Ошибка отправки: ' + errorMessage, 'error');
          resetButtonAfterDelay(button, CONFIRM_SEND_ICON, 'Отправить подтверждение');
        }
      );
    } catch (error) {
      console.error('[KonturPrepay] Ошибка:', error);
      setButtonState(button, 'error', '❌ Ошибка');
      showToast('Ошибка: ' + error.message, 'error');
      resetButtonAfterDelay(button, CONFIRM_SEND_ICON, 'Отправить подтверждение');
    }
  }

  // ─── Создание кнопок ──────────────────────────────────────

  function createButtons() {
    var wrapper = document.createElement('span');
    wrapper.id = WRAPPER_ID;
    wrapper.className = 'kontur-prepay-group';

    // Кнопка «Скачать счёт» (secondary — outline)
    var downloadBtn = document.createElement('button');
    downloadBtn.id = BTN_DOWNLOAD_ID;
    downloadBtn.className = 'kontur-prepay-btn kontur-prepay-btn--secondary';
    downloadBtn.type = 'button';
    downloadBtn.setAttribute('data-variant', 'secondary');
    downloadBtn.innerHTML = DOWNLOAD_ICON + ' Скачать счёт';
    downloadBtn.addEventListener('click', handleDownloadClick);

    // Кнопка «Отправить на email» (primary — заливка)
    var sendBtn = document.createElement('button');
    sendBtn.id = BTN_SEND_ID;
    sendBtn.className = 'kontur-prepay-btn';
    sendBtn.type = 'button';
    sendBtn.setAttribute('data-variant', 'primary');
    sendBtn.innerHTML = SEND_ICON + ' Отправить на email';
    sendBtn.addEventListener('click', handleSendClick);

    wrapper.appendChild(downloadBtn);
    wrapper.appendChild(sendBtn);

    return wrapper;
  }

  // ─── Создание кнопок подтверждения ─────────────────────────

  function createConfirmationButtons() {
    var wrapper = document.createElement('span');
    wrapper.id = CONFIRM_WRAPPER_ID;
    wrapper.className = 'kontur-confirm-group';

    // Кнопка «Скачать подтверждение» (secondary — outline зелёная)
    var downloadBtn = document.createElement('button');
    downloadBtn.id = BTN_CONFIRM_DOWNLOAD_ID;
    downloadBtn.className = 'kontur-confirm-btn kontur-confirm-btn--secondary';
    downloadBtn.type = 'button';
    downloadBtn.setAttribute('data-variant', 'secondary');
    downloadBtn.setAttribute('data-btn-type', 'confirm');
    downloadBtn.innerHTML = CONFIRM_DOWNLOAD_ICON + ' Скачать подтверждение';
    downloadBtn.addEventListener('click', handleConfirmDownloadClick);

    // Кнопка «Отправить подтверждение» (primary — зелёная заливка)
    var sendBtn = document.createElement('button');
    sendBtn.id = BTN_CONFIRM_SEND_ID;
    sendBtn.className = 'kontur-confirm-btn';
    sendBtn.type = 'button';
    sendBtn.setAttribute('data-variant', 'primary');
    sendBtn.setAttribute('data-btn-type', 'confirm');
    sendBtn.innerHTML = CONFIRM_SEND_ICON + ' Отправить подтверждение';
    sendBtn.addEventListener('click', handleConfirmSendClick);

    wrapper.appendChild(downloadBtn);
    wrapper.appendChild(sendBtn);

    return wrapper;
  }

  // ─── Скрытие встроенных элементов подтверждения ─────────────

  /**
   * Скрывает блок «Подтверждение не отправлено» / «Подтверждение отправлено»
   * из шапки бронирования.
   */
  function hideNativeConfirmationBlock() {
    var container = document.getElementById('MainPageTopBar');
    if (!container) return false;

    var spans = container.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var text = (spans[i].textContent || '').trim();
      if (spans[i].childElementCount === 0 &&
          (text === 'Подтверждение не отправлено' || text === 'Подтверждение отправлено')) {
        // Поднимаемся вверх до span-обёртки с margin-left (контейнер блока)
        var parent = spans[i].parentElement;
        while (parent && parent !== container) {
          if (parent.tagName === 'SPAN' && parent.style.marginLeft) {
            parent.style.display = 'none';
            return true;
          }
          parent = parent.parentElement;
        }
      }
    }
    return false;
  }

  /**
   * Удаляет пункт «Отправить подтверждение» из выпадающего меню «Другие действия».
   */
  function hideNativeConfirmationMenuItem() {
    var menuItems = document.querySelectorAll('[data-tid="MenuItem__root"]');
    for (var j = 0; j < menuItems.length; j++) {
      var itemText = (menuItems[j].textContent || '').trim();
      if (itemText === 'Отправить подтверждение') {
        var wrapper = menuItems[j].parentElement;
        if (wrapper && wrapper.tagName === 'SPAN') {
          wrapper.style.display = 'none';
        } else {
          menuItems[j].style.display = 'none';
        }
        return true;
      }
    }
    return false;
  }

  // ─── Стрелка-подсказка на иконку «i» (цены по дням) ─────────

  /**
   * Находит иконку «i» (info) рядом со стоимостью проживания.
   * При наведении на неё появляется тултип с посуточными ценами.
   */
  function findPriceInfoIcon() {
    var container = document.getElementById('MainPageTopBar');
    if (!container) return null;

    var svgs = container.querySelectorAll('svg[data-tid="Icon__root"]');
    for (var i = 0; i < svgs.length; i++) {
      var paths = svgs[i].querySelectorAll('path');
      for (var j = 0; j < paths.length; j++) {
        var d = paths[j].getAttribute('d') || '';
        // Характерный path точки буквы «i» в круге
        if (d.indexOf('M7.25 5.5') !== -1) {
          var trigger = svgs[i].closest('[tabindex]');
          return trigger || svgs[i].parentElement;
        }
      }
    }
    return null;
  }

  /**
   * Показывает анимированную стрелку-подсказку рядом с иконкой «i».
   * Стрелка исчезает через 8 секунд или при захвате посуточных цен.
   */
  function showArrowHint() {
    hideArrowHint();

    var icon = findPriceInfoIcon();
    if (!icon) return;

    var rect = icon.getBoundingClientRect();

    var hint = document.createElement('div');
    hint.id = ARROW_HINT_ID;
    hint.className = 'kontur-arrow-hint';
    hint.innerHTML =
      '<div class="kontur-arrow-hint__arrow">▲</div>' +
      '<div class="kontur-arrow-hint__text">Наведите сюда</div>';

    hint.style.left = Math.round(rect.left + rect.width / 2) + 'px';
    hint.style.top = Math.round(rect.bottom + 6) + 'px';

    document.body.appendChild(hint);

    arrowHintTimer = setTimeout(hideArrowHint, 8000);
  }

  /** Скрывает стрелку-подсказку. */
  function hideArrowHint() {
    if (arrowHintTimer) {
      clearTimeout(arrowHintTimer);
      arrowHintTimer = null;
    }
    var el = document.getElementById(ARROW_HINT_ID);
    if (el) el.remove();
  }

  // ─── Захват посуточных цен из тултипа ─────────────────────

  /**
   * Захватывает посуточные цены из видимого тултипа «Стоимость проживания».
   * Вызывается немедленно (без debounce) при любом изменении DOM,
   * чтобы не пропустить короткоживущий тултип.
   *
   * При первом наведении React может рендерить содержимое тултипа асинхронно —
   * контейнер уже в DOM, но цены внутри ещё не отрисованы.
   * В этом случае планируется повторная попытка через 150–300 мс.
   */
  function tryCaptureDailyRates() {
    var rates = parseDailyRatesFromTooltip();
    if (rates.length > 0) {
      cachedDailyRates = rates;
      hideArrowHint();
      if (tooltipRetryTimer) {
        clearTimeout(tooltipRetryTimer);
        tooltipRetryTimer = null;
      }
      console.log('[KonturPrepay] Цены по дням захвачены:', rates);
      return;
    }

    // Тултип есть, но данные ещё не загружены — повторить через 150 мс
    // (React может рендерить содержимое тултипа асинхронно при первом открытии)
    if (!tooltipRetryTimer && (!cachedDailyRates || cachedDailyRates.length === 0)) {
      var tooltip = document.querySelector('[data-tid="Tooltip__content"]');
      if (tooltip) {
        tooltipRetryTimer = setTimeout(function () {
          tooltipRetryTimer = null;
          var retryRates = parseDailyRatesFromTooltip();
          if (retryRates.length > 0) {
            cachedDailyRates = retryRates;
            hideArrowHint();
            console.log('[KonturPrepay] Цены по дням захвачены (retry):', retryRates);
            // Также инжектируем блок предоплаты в тултип (если ещё виден)
            tryInjectPrepayIntoTooltip();
          }
        }, 150);
      }
    }
  }

  // ─── Отображение предоплаты в тултипе ───────────────────

  /**
   * Добавляет строку «Предоплата» в тултип «Стоимость проживания».
   * Показывает сумму первых 3 суток.
   */
  function tryInjectPrepayIntoTooltip() {
    var tooltips = document.querySelectorAll('[data-tid="Tooltip__content"]');
    for (var i = 0; i < tooltips.length; i++) {
      var tooltip = tooltips[i];
      var text = tooltip.textContent || '';
      if (text.indexOf('Стоимость проживания') === -1) continue;

      // Уже добавлено
      if (tooltip.querySelector('#' + TOOLTIP_PREPAY_ID)) continue;

      var rates = parseDailyRatesFromElement(tooltip);
      if (rates.length === 0) continue;

      // Считаем предоплату (первые 3 суток)
      var prepay = 0;
      var daysForPrepay = Math.min(3, rates.length);
      for (var d = 0; d < daysForPrepay; d++) {
        prepay += rates[d];
      }

      // Ищем блок «Итого за проживание» для вставки после него
      var allSpans = tooltip.querySelectorAll('span');
      var totalSpan = null;
      for (var s = 0; s < allSpans.length; s++) {
        if ((allSpans[s].textContent || '').indexOf('Итого за проживание') !== -1) {
          totalSpan = allSpans[s];
          break;
        }
      }

      // Поднимаемся до контейнера секции «Итого»
      var insertAfter = null;
      if (totalSpan) {
        insertAfter = totalSpan;
        for (var up = 0; up < 5; up++) {
          if (insertAfter.parentElement && insertAfter.parentElement !== tooltip) {
            insertAfter = insertAfter.parentElement;
          }
        }
      }

      var prepayBlock = document.createElement('div');
      prepayBlock.id = TOOLTIP_PREPAY_ID;
      prepayBlock.className = 'kontur-tooltip-prepay';

      var daysLabel = daysForPrepay < 3
        ? daysForPrepay + ' ' + pluralize(daysForPrepay, 'сутки', 'суток', 'суток')
        : '3 сут.';
      prepayBlock.innerHTML =
        '<span>Предоплата (первые ' + daysLabel + '): ' +
        '<strong>' + formatMoney(prepay) + ' ₽</strong></span>';

      if (insertAfter && insertAfter.parentElement) {
        insertAfter.parentElement.insertBefore(prepayBlock, insertAfter.nextSibling);
      } else {
        var scrollInner = tooltip.querySelector('[data-tid="ScrollContainer__inner"]');
        if (scrollInner) {
          scrollInner.appendChild(prepayBlock);
        } else {
          tooltip.appendChild(prepayBlock);
        }
      }

      console.log('[KonturPrepay] Блок предоплаты добавлен в тултип');
    }
  }

  // ─── Инъекция кнопок ──────────────────────────────────────

  function tryInjectButton() {
    if (!isBookingPage()) {
      return false;
    }

    var container = findBookingContainer();
    if (!container) {
      return false;
    }

    var target = findButtonInsertionPoint(container);
    if (!target) {
      var headerLinks = container.querySelectorAll('a, button');
      for (var i = 0; i < headerLinks.length; i++) {
        var t = (headerLinks[i].textContent || '').trim();
        if (t === 'Редактировать бронирование') {
          target = headerLinks[i].closest('div[data-tid="Gapped__horizontal"]') ||
                   headerLinks[i].parentElement;
          break;
        }
      }
    }

    if (!target) {
      var stickyRoot = container.querySelector('[data-tid="Sticky__root"]');
      target = stickyRoot || container;
    }

    // Инжектируем кнопки счёта (если ещё не добавлены)
    if (!document.getElementById(WRAPPER_ID)) {
      var invoiceButtons = createButtons();
      target.appendChild(invoiceButtons);
      console.log('[KonturPrepay] Кнопки «Скачать счёт» и «Отправить на email» добавлены');
    }

    // Инжектируем кнопки подтверждения (если ещё не добавлены)
    if (!document.getElementById(CONFIRM_WRAPPER_ID)) {
      var confirmButtons = createConfirmationButtons();
      target.appendChild(confirmButtons);
      console.log('[KonturPrepay] Кнопки «Скачать подтверждение» и «Отправить подтверждение» добавлены');
    }

    // Скрываем встроенный блок подтверждения
    hideNativeConfirmationBlock();

    // Скрываем пункт меню «Отправить подтверждение»
    hideNativeConfirmationMenuItem();

    return true;
  }

  // ─── Удаление кнопок ──────────────────────────────────────

  function removeButtonIfOrphaned() {
    if (!isBookingPage()) {
      var wrapper = document.getElementById(WRAPPER_ID);
      if (wrapper) {
        wrapper.remove();
        console.log('[KonturPrepay] Кнопки счёта удалены (не страница бронирования)');
      }
      var confirmWrapper = document.getElementById(CONFIRM_WRAPPER_ID);
      if (confirmWrapper) {
        confirmWrapper.remove();
        console.log('[KonturPrepay] Кнопки подтверждения удалены (не страница бронирования)');
      }
    }
  }

  // ─── MutationObserver + SPA-навигация ───────────────────────

  var debounceTimer = null;

  function onDomChange() {
    var currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      cachedDailyRates = null; // Сбрасываем кеш при смене бронирования
      if (tooltipRetryTimer) {
        clearTimeout(tooltipRetryTimer);
        tooltipRetryTimer = null;
      }
      var oldWrapper = document.getElementById(WRAPPER_ID);
      if (oldWrapper) {
        oldWrapper.remove();
      }
      var oldConfirmWrapper = document.getElementById(CONFIRM_WRAPPER_ID);
      if (oldConfirmWrapper) {
        oldConfirmWrapper.remove();
      }
    }

    // Немедленно (без debounce) пытаемся захватить цены из тултипа
    // и добавить блок предоплаты — тултип может исчезнуть быстро
    tryCaptureDailyRates();
    tryInjectPrepayIntoTooltip();

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(function () {
      tryInjectButton();
      removeButtonIfOrphaned();

      // Повторно проверяем скрытие встроенных элементов
      // (меню может быть создано динамически)
      if (isBookingPage()) {
        hideNativeConfirmationBlock();
        hideNativeConfirmationMenuItem();
      }
    }, OBSERVER_DEBOUNCE_MS);
  }

  function startObserver() {
    var observer = new MutationObserver(onDomChange);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('[KonturPrepay] MutationObserver запущен на', window.location.href);
    tryInjectButton();
  }

  // ─── Инициализация ──────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
