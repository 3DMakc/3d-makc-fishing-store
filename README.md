# 3D_MAKC Fishing — полноценный интернет-магазин (MVP)

Это готовый рабочий магазин:
- каталог / категории / карточка товара
- корзина
- оформление заказа (ФИО, телефон, область, город, отделение НП, комментарий)
- сохранение заказов в базе (SQLite)
- уведомления о заказах в Telegram
- админка: логин, добавление/редактирование товаров, импорт из CSV

## Быстрый старт (локально)
1) Установи Node.js LTS (18+).
2) В папке проекта:
   ```bash
   npm install
   cp .env.example .env
   npm run dev
   ```
3) Открой: http://localhost:3000

## Telegram уведомления
1) Создай бота у @BotFather, получи токен.
2) Узнай chat_id:
   - Напиши боту любое сообщение
   - Открой в браузере:
     https://api.telegram.org/bot<TOKEN>/getUpdates
   - Найди chat.id
3) Заполни в .env: TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.

## Админка
- URL: /admin
- Логин/пароль берутся из .env (ADMIN_USER / ADMIN_PASSWORD)

## Импорт товаров из CSV
В админке: Products → Import CSV

Формат CSV (заголовки обязательно):
name,sku,price_uah,stock,brand,category,description,images
Пример images: "https://site/img1.jpg|https://site/img2.jpg"

## Деплой (VPS / Hosting)
Рекомендую VPS (Hetzner/OVH/UKR) + Nginx.
Шаги в общих чертах:
- установить Node.js, npm
- залить проект
- `npm install --omit=dev`
- настроить `.env`
- запустить через pm2 (или systemd)
- проксировать Nginx на localhost:3000

Если скажешь где будешь хостить — дам точную пошаговую инструкцию.

## Дизайн
Темный премиум: черный/белый/оранжевый (под твой логотип).
CSS лежит в `public/styles.css`.
