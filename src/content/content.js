/**
 * Content Script — главный модуль расширения.
 *
 * Запускается на hotel.kontur.ru и:
 *  1. Отслеживает SPA-навигацию и изменения DOM
 *  2. На странице бронирования добавляет две кнопки:
 *     - «Скачать счёт» — генерирует PDF и скачивает
 *     - «Отправить счёт» — генерирует PDF и отправляет на email гостя
 *
 * Зависимости (загружаются раньше через manifest.json content_scripts):
 *  - jspdf.umd.min.js    (глобальная jspdf)
 *  - qrcode.js            (qrcode)
 *  - roboto-regular.js    (ROBOTO_FONT_BASE64)
 *  - hotel-details.js     (HOTEL_DETAILS)
 *  - data-parser.js       (parseBookingData, findBookingContainer, findButtonInsertionPoint, isBookingPage)
 *  - invoice-generator.js (generateInvoicePDF)
 *  - email-sender.js      (sendInvoiceEmail)
 */

(function () {
  'use strict';

  // ─── Константы ──────────────────────────────────────────────
  var WRAPPER_ID = 'kontur-prepay-wrapper';
  var BTN_DOWNLOAD_ID = 'kontur-prepay-download-btn';
  var BTN_SEND_ID = 'kontur-prepay-send-btn';
  var OBSERVER_DEBOUNCE_MS = 500;
  var lastUrl = window.location.href;

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

    // Сохраняем базовый класс (primary или secondary)
    var isPrimary = button.getAttribute('data-variant') === 'primary';
    button.className = isPrimary ? 'kontur-prepay-btn' : 'kontur-prepay-btn kontur-prepay-btn--secondary';

    if (state === 'loading') {
      button.classList.add('kontur-prepay-btn--loading');
    } else if (state === 'success') {
      button.classList.add('kontur-prepay-btn--success');
    } else if (state === 'error') {
      button.classList.add('kontur-prepay-btn--error');
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
    var bookingData = parseBookingData();

    if (!bookingData) {
      setButtonState(button, 'error', '❌ Ошибка парсинга');
      showToast('Не удалось прочитать данные бронирования.', 'error');
      resetButtonAfterDelay(button, icon, label);
      return null;
    }

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

      sendInvoiceEmail(
        {
          to: bookingData.guestEmail,
          guestName: bookingData.guestName,
          bookingNumber: bookingData.bookingNumber,
          pdfBase64: pdfResult.base64,
          pdfFilename: pdfResult.filename
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

  // ─── Инъекция кнопок ──────────────────────────────────────

  function tryInjectButton() {
    if (document.getElementById(WRAPPER_ID)) {
      return false;
    }

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

    var buttons = createButtons();
    target.appendChild(buttons);

    console.log('[KonturPrepay] Кнопки «Скачать счёт» и «Отправить на email» добавлены');
    return true;
  }

  // ─── Удаление кнопок ──────────────────────────────────────

  function removeButtonIfOrphaned() {
    var wrapper = document.getElementById(WRAPPER_ID);
    if (!wrapper) {
      return;
    }

    if (!isBookingPage()) {
      wrapper.remove();
      console.log('[KonturPrepay] Кнопки удалены (не страница бронирования)');
    }
  }

  // ─── MutationObserver + SPA-навигация ───────────────────────

  var debounceTimer = null;

  function onDomChange() {
    var currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      var oldWrapper = document.getElementById(WRAPPER_ID);
      if (oldWrapper) {
        oldWrapper.remove();
      }
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(function () {
      tryInjectButton();
      removeButtonIfOrphaned();
    }, OBSERVER_DEBOUNCE_MS);
  }

  function startObserver() {
    var observer = new MutationObserver(onDomChange);
    observer.observe(document.body, {
      childList: true,
      subtree: true
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
