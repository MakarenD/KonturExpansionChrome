/**
 * Popup script — управление настройками расширения.
 *
 * Сохраняет и загружает URL backend-сервера и API-ключ
 * из chrome.storage.local.
 *
 * SMTP-данные (email, пароль Яндекс) хранятся только на сервере Vercel
 * в переменных окружения — сотрудники их не видят.
 */

(function () {
  'use strict';

  // ─── DOM-элементы ───────────────────────────────────────────

  var form = document.getElementById('settingsForm');
  var backendUrlInput = document.getElementById('backendUrl');
  var apiKeyInput = document.getElementById('apiKey');
  var saveBtn = document.getElementById('saveBtn');
  var testBtn = document.getElementById('testBtn');
  var statusEl = document.getElementById('status');
  var statusTextEl = document.getElementById('statusText');
  var messageEl = document.getElementById('message');

  // ─── Загрузка сохранённых настроек ──────────────────────────

  chrome.storage.local.get(
    ['backendUrl', 'apiKey'],
    function (data) {
      if (data.backendUrl) {
        backendUrlInput.value = data.backendUrl;
      }
      if (data.apiKey) {
        apiKeyInput.value = data.apiKey;
      }

      updateStatus(data);
    }
  );

  // ─── Сохранение настроек ────────────────────────────────────

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var settings = {
      backendUrl: backendUrlInput.value.trim().replace(/\/+$/, ''),
      apiKey: apiKeyInput.value.trim()
    };

    // Валидация
    if (!settings.backendUrl) {
      showMessage('Укажите URL сервера', 'error');
      return;
    }
    if (!settings.apiKey) {
      showMessage('Укажите API-ключ', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохранение...';

    chrome.storage.local.set(settings, function () {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить';

      if (chrome.runtime.lastError) {
        showMessage('Ошибка сохранения: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showMessage('Настройки сохранены', 'success');
        updateStatus(settings);
      }
    });
  });

  // ─── Тест подключения ──────────────────────────────────────

  testBtn.addEventListener('click', function () {
    var backendUrl = backendUrlInput.value.trim().replace(/\/+$/, '');
    var apiKey = apiKeyInput.value.trim();

    if (!backendUrl) {
      showMessage('Сначала укажите URL сервера', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Проверка...';

    // Проверяем доступность backend (OPTIONS-запрос)
    fetch(backendUrl + '/api/send-invoice', {
      method: 'OPTIONS',
      mode: 'cors',
      headers: apiKey ? { 'X-API-Key': apiKey } : {}
    })
      .then(function (response) {
        testBtn.disabled = false;
        testBtn.textContent = 'Тест подключения';

        if (response.ok) {
          showMessage('Сервер доступен!', 'success');
        } else {
          showMessage(
            'Сервер ответил с ошибкой: ' + response.status,
            'error'
          );
        }
      })
      .catch(function (error) {
        testBtn.disabled = false;
        testBtn.textContent = 'Тест подключения';
        showMessage(
          'Не удалось подключиться к серверу: ' + error.message,
          'error'
        );
      });
  });

  // ─── Вспомогательные функции ────────────────────────────────

  /** Обновляет индикатор статуса. */
  function updateStatus(settings) {
    var hasAll = settings.backendUrl && settings.apiKey;

    statusEl.className = 'popup__status';

    if (hasAll) {
      statusEl.classList.add('popup__status--ok');
      statusTextEl.textContent = 'Настройки заполнены';
    } else {
      statusEl.classList.add('popup__status--error');
      var missing = [];
      if (!settings.backendUrl) {
        missing.push('URL сервера');
      }
      if (!settings.apiKey) {
        missing.push('API-ключ');
      }
      statusTextEl.textContent = 'Не заполнено: ' + missing.join(', ');
    }
  }

  /** Показывает сообщение под формой. */
  function showMessage(text, type) {
    messageEl.style.display = 'block';
    messageEl.className = 'popup__message popup__message--' + type;
    messageEl.textContent = text;

    // Скрываем через 4 секунды
    setTimeout(function () {
      messageEl.style.display = 'none';
    }, 4000);
  }
})();
