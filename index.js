require('dotenv').config();
const bot = require('./src/bot/index');
const { init } = require('./src/db/index');

init().then(() => {
  bot.launch().then(() => {
    console.log('🚀 Бот запущен');
  });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));