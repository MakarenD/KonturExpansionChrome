# QWEN.md — Контекст проекта KonturExpansionChrome

## Обзор проекта

**KonturExpansionChrome** — это Chrome-расширение для системы Контур Отель (hotel.kontur.ru), автоматизирующее формирование и отправку документов гостям: счетов на предоплату и подтверждений бронирования (ваучеров).

### Основной функционал

1. **Счёт на предоплату**
   - Автоматический парсинг данных бронирования из DOM hotel.kontur.ru
   - Расчёт предоплаты: сумма первых 3 суток (из тултипа «Стоимость проживания»)
   - Генерация PDF-счёта с реквизитами отеля, QR-кодами для оплаты (ГОСТ Р 56042-2014)
   - **Логика QR-кодов:**
     - 1–3 ночи: 1 QR-код (предоплата = полная сумма)
     - 4+ ночи: 2 QR-кода (предоплата + полная оплата со скидкой)
   - Скидки за длительное проживание: 4–5 ночей → 5%, 6+ ночей → 8%
   - Отправка PDF на email гостя через Яндекс SMTP
   - Сохранение в «Отправленные» через IMAP

2. **Подтверждение бронирования (Ваучер)**
   - Генерация компактного PDF на 1 лист А4
   - Полная информация о бронировании, условия заезда/выезда, отмены
   - Встроенные печать и подпись директора
   - Скачивание и отправка на email

### Архитектура (многопользовательский режим)

```
Сотрудник 1 (Chrome) ──┐
Сотрудник 2 (Chrome) ──┼──► Backend на Vercel ──► Яндекс SMTP ──► Email гостя
Сотрудник N (Chrome) ──┘    (один на всех)
```

- **Backend** развёртывается один раз администратором на Vercel
- **SMTP-пароль** хранится только в переменных окружения Vercel
- **Расширение** устанавливается на каждый рабочий ПК
- **API-ключ** защищает backend от несанкционированного доступа

---

## Структура проекта

```
KonturExpansionChrome/
├── manifest.json                    # Манифест расширения (Manifest V3)
├── README.md                        # Документация для пользователей
├── QWEN.md                          # Этот файл — контекст для разработчиков
├── печать.png                       # Изображение печати (для PDF)
├── подпись.png                      # Изображение подписи (для PDF)
│
├── src/                             # Исходный код расширения
│   ├── content/
│   │   ├── content.js               # Content script: кнопки, парсинг DOM, тултипы, стрелка-подсказка
│   │   └── content.css              # Стили кнопок, тостов, тултипов, стрелки
│   │
│   ├── background/
│   │   └── service-worker.js        # Service Worker: обработка сообщений, отправка через backend
│   │
│   ├── popup/
│   │   ├── popup.html               # Интерфейс настроек (URL сервера + API-ключ)
│   │   ├── popup.js                 # Логика попапа
│   │   └── popup.css                # Стили попапа
│   │
│   ├── utils/
│   │   ├── data-parser.js           # Парсинг DOM hotel.kontur.ru (номер, даты, цены, гости)
│   │   ├── invoice-generator.js     # Генерация PDF-счёта (jsPDF, QR-коды)
│   │   ├── confirmation-generator.js # Генерация PDF ваучера (1 лист А4)
│   │   └── email-sender.js          # Клиент для отправки email через service worker
│   │
│   ├── config/
│   │   └── hotel-details.js         # Реквизиты отеля (ИНН, р/с, банк, адрес)
│   │
│   ├── fonts/
│   │   └── roboto-regular.js        # Шрифт Roboto (base64) для кириллицы в PDF
│   │
│   └── images/
│       └── stamp-signature.js       # Печать и подпись директора (base64 PNG)
│
├── libs/                            # Сторонние библиотеки
│   ├── jspdf.umd.min.js            # jsPDF v2.5.2 — генерация PDF
│   └── qrcode.js                   # qrcode-generator v1.4.4 — QR-коды
│
├── icons/                           # Иконки расширения (16, 48, 128 px)
│
└── backend/                         # Серверная часть (Vercel serverless)
    ├── api/
    │   └── send-invoice.js          # Endpoint: POST /api/send-invoice
    ├── package.json                 # Зависимости: nodemailer, imapflow, busboy
    └── vercel.json                  # CORS headers для API
```

---

## Ключевые технологии

| Компонент | Технология | Назначение |
|-----------|-----------|------------|
| **Расширение** | Chrome Extension Manifest V3 | Современный стандарт расширений |
| **PDF** | jsPDF 2.5.2 | Генерация PDF на клиенте |
| **QR-коды** | qrcode-generator 1.4.4 | Генерация QR (ГОСТ Р 56042-2014) |
| **Backend** | Vercel Serverless Functions | Хостинг API |
| **SMTP** | Nodemailer | Отправка email через Яндекс (smtp.yandex.ru:465) |
| **IMAP** | ImapFlow | Сохранение в «Отправленные» (imap.yandex.ru:993) |
| **Multipart** | Busboy | Парсинг multipart/form-data на сервере |
| **Шрифт** | Roboto (base64) | Поддержка кириллицы в PDF |

---

## Сборка и запуск

### Установка на рабочий ПК (для разработчика)

1. Откройте `chrome://extensions/`
2. Включите **Режим разработчика**
3. Нажмите **Загрузить распакованное расширение**
4. Выберите папку `KonturExpansionChrome/`
5. Кликните на иконку расширения → заполните настройки:
   - **URL сервера**: `https://your-app.vercel.app`
   - **API-ключ**: `your-secret-key`

### Развёртывание backend (для администратора)

```bash
cd backend
npm install

# Деплой на Vercel
npx vercel

# Установка переменных окружения
npx vercel env add SMTP_EMAIL      # hotel@yandex.ru
npx vercel env add SMTP_PASSWORD   # пароль приложения Яндекс
npx vercel env add API_KEY         # ваш секретный ключ

# Деплой в продакшен
npx vercel --prod
```

---

## Точки расширения (Extension Points)

### 1. Настройка реквизитов отеля

**Файл**: `src/config/hotel-details.js`

```javascript
var HOTEL_DETAILS = {
  name: 'ООО «Альбатрос»',
  inn: '2543193969',
  // ... заполните реальными данными
};
```

### 2. Изменение логики скидок и QR-кодов

**Файл**: `src/utils/data-parser.js` (функция `calculateDiscount`)

Текущая логика скидок:
- 1–3 ночи: 0%
- 4–5 ночей: 5%
- 6+ ночи: 8%

**Логика отображения QR-кодов** реализована в `src/utils/invoice-generator.js`:

```javascript
// Второй QR-код отображается только если предоплата < полной суммы
var needsSecondQR = bookingData.prepayAmount < bookingData.totalPrice;
```

- **1–3 ночи**: 1 QR-код (предоплата = полная сумма, второй QR не нужен)
- **4+ ночи**: 2 QR-кода (предоплата + полная оплата со скидкой)

Для изменения порога отображения второго QR-кода модифицируйте условие `needsSecondQR`.

### 3. Модификация PDF-шаблонов

**Файлы**:
- `src/utils/invoice-generator.js` — счёт на предоплату
- `src/utils/confirmation-generator.js` — ваучер

Оба файла используют jsPDF API. Шрифт Roboto регистрируется через `registerCyrillicFont()`.

### 4. Парсинг новых полей из DOM

**Файл**: `src/utils/data-parser.js`

Парсер не зависит от хешированных CSS-классов Контур Отеля. Использует:
- Стабильный `#MainPageTopBar`
- Текстовые маркеры разделов («Оплата», «Гости», «Информация»)
- Regex-паттерны (OTL-..., email, цена ₽)

Для добавления нового поля:
1. Создайте функцию `parseNewField(container, pageText)`
2. Вызовите её в `parseBookingData()`
3. Добавьте поле в возвращаемый объект

### 5. Изменение SMTP-провайдера

**Файл**: `backend/api/send-invoice.js`

Замените конфигурацию `nodemailer.createTransport()`:

```javascript
var transporter = nodemailer.createTransport({
  host: 'smtp.yandex.ru',  // измените на ваш SMTP
  port: 465,
  // ...
});
```

---

## Безопасность

### Хранение секретов

| Данные | Где хранятся |
|--------|-------------|
| SMTP-пароль | Vercel Environment Variables (не в коде) |
| API-ключ | Vercel Environment Variables + Chrome Storage (локально) |
| Реквизиты отеля | `src/config/hotel-details.js` (публично) |

### Авторизация запросов

Каждый запрос к backend включает заголовок `X-API-Key`. Backend проверяет:

```javascript
if (clientApiKey !== serverApiKey) {
  return res.status(401).json({ error: 'Неверный API-ключ' });
}
```

### Оптимизация передачи данных

PDF передаётся как **multipart/form-data** (бинарный файл), а не base64 в JSON:
- Экономия ~33% трафика
- Избегание лимитов payload Vercel

---

## Отладка и тестирование

### Логирование в content script

Откройте DevTools на странице hotel.kontur.ru → Console:

```javascript
[KonturPrepay] Цены по дням захвачены: [1500, 1500, 1500, ...]
[KonturPrepay] Размер PDF: 842 КБ (бинарный)
```

### Логирование на backend

После деплоя на Vercel:

```bash
npx vercel logs
```

Или в дашборде Vercel → Functions → send-invoice → Logs

### Тестирование без реального бронирования

1. Откройте `chrome://extensions/` → Reload расширения
2. Откройте `src/content/content.js` → Console
3. Используйте `parseBookingData()` вручную для проверки парсинга

---

## Известные ограничения

1. **Зависимость от DOM Контур Отеля**
   - Парсер использует текстовые маркеры и стабильные id
   - При крупных изменениях Контур Отеля может потребоваться обновление `data-parser.js`

2. **Яндекс SMTP**
   - Требуется пароль приложения (не основной пароль)
   - Лимиты: до 1000 писем в день для бесплатных аккаунтов

3. **Vercel Serverless**
   - Лимит выполнения: 10 секунд (достаточно для отправки email)
   - Лимит payload: 4.5 MB (PDF ~800 КБ проходит)

4. **Manifest V3**
   - Service Worker может завершаться при простое
   - Все долгосрочные операции — в background script

---

## Глоссарий

| Термин | Значение |
|--------|----------|
| **Content Script** | JavaScript расширения, работающий на hotel.kontur.ru |
| **Service Worker** | Фоновый скрипт расширения (background) |
| **Vercel** | Платформа для хостинга serverless-функций |
| **IMAP special-use** | Стандарт RFC 6154 для системных папок (Sent, Drafts) |
| **ГОСТ Р 56042-2014** | Российский стандарт QR-кодов для платежей |

---

## Связанные документы

- [`README.md`](./README.md) — документация для пользователей
- [`manifest.json`](./manifest.json) — конфигурация расширения
- [`backend/package.json`](./backend/package.json) — зависимости backend

---

## Контакты и поддержка

При возникновении проблем:
1. Проверьте логи в Console (content script)
2. Проверьте логи Vercel (`npx vercel logs`)
3. Убедитесь, что API-ключ совпадает в настройках расширения и Vercel
4. Проверьте переменные окружения SMTP_EMAIL / SMTP_PASSWORD
