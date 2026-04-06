require('dotenv').config();
const bot = require('./src/bot/index');
const { init } = require('./src/db/index');
const api = require('./src/api/index');

const PORT = process.env.PORT || 3000;

init().then(() => {
  // Запускаем API сервер
  api.listen(PORT, () => {
    console.log(`🌐 API запущен на порту ${PORT}`);
  });

  // Запускаем бота
  bot.launch().then(() => {
    console.log('🚀 Бот запущен');
  });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));