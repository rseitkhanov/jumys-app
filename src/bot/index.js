const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const { pool } = require('../db/index');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Сессии
bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

// Сохраняем пользователя
const saveUser = async (tg_id, first_name) => {
  await pool.query(`
    INSERT INTO users (tg_id, first_name)
    VALUES ($1, $2)
    ON CONFLICT (tg_id) DO NOTHING
  `, [tg_id, first_name]);
};

// Главное меню
const mainMenu = (ctx) => {
  ctx.session.step = null;
  ctx.session.vacancy = {};
  const name = ctx.from.first_name;
  ctx.reply(
    `👋 Привет, ${name}!\n\nДобро пожаловать в Жұмыс — работа по Казахстану.\n\nКто ты?`,
    Markup.keyboard([
      ['🔍 Ищу работу'],
      ['📢 Публикую вакансию']
    ]).resize()
  );
};

bot.start(async (ctx) => {
  await saveUser(ctx.from.id, ctx.from.first_name);
  mainMenu(ctx);
});

// Соискатель
bot.hears('🔍 Ищу работу', async (ctx) => {
  ctx.session.step = null;
  await pool.query(`UPDATE users SET role = 'seeker' WHERE tg_id = $1`, [ctx.from.id]);
  ctx.reply(
    '📍 Выбери город:',
    Markup.keyboard([
      ['Семей', 'Алматы'],
      ['Астана', 'Шымкент'],
      ['⬅️ Назад']
    ]).resize()
  );
});

// Работодатель — начало формы
bot.hears('📢 Публикую вакансию', async (ctx) => {
  await pool.query(`UPDATE users SET role = 'employer' WHERE tg_id = $1`, [ctx.from.id]);
  ctx.session.step = 'title';
  ctx.session.vacancy = {};
  ctx.reply(
    '💼 Шаг 1/4\n\nНапиши должность:\nНапример: Повар, Грузчик, Продавец-консультант',
    Markup.keyboard([['⬅️ Назад']]).resize()
  );
});

// Выбор города для соискателя
const cities = ['Семей', 'Алматы', 'Астана', 'Шымкент'];

cities.forEach(city => {
  bot.hears(city, async (ctx) => {
    // Если работодатель выбирает город для вакансии
    if (ctx.session.step === 'city') {
      ctx.session.vacancy.city = city;
      ctx.session.step = 'salary';
      return ctx.reply(
        '💰 Шаг 4/4\n\nУкажи зарплату:\nНапример: 150 000 тг, от 200 000 тг, Договорная',
        Markup.keyboard([['Договорная'], ['⬅️ Назад']]).resize()
      );
    }

    // Соискатель ищет работу
    await pool.query(`UPDATE users SET city = $1 WHERE tg_id = $2`, [city, ctx.from.id]);

    const { rows } = await pool.query(`
      SELECT * FROM vacancies 
      WHERE city = $1 AND status = 'active'
      ORDER BY is_urgent DESC, created_at DESC
      LIMIT 10
    `, [city]);

    if (rows.length === 0) {
      return ctx.reply(
        `😔 В городе ${city} пока нет вакансий.`,
        Markup.keyboard([
          ['🔍 Искать в другом городе'],
          ['⬅️ Назад']
        ]).resize()
      );
    }

    await ctx.reply(`📋 Вакансии в городе ${city}:`);

    for (const v of rows) {
      const urgent = v.is_urgent ? '🔴 СРОЧНО\n' : '';
      const salary = v.salary || 'Договорная';
      await ctx.reply(
        `${urgent}💼 ${v.title}\n💰 ${salary}\n📂 ${v.category || 'Без категории'}`,
        Markup.inlineKeyboard([
          Markup.button.callback('📞 Откликнуться', `apply_${v.id}`)
        ])
      );
    }
  });
});

// Отклик
bot.action(/apply_(\d+)/, async (ctx) => {
  const vacancyId = ctx.match[1];
  const { rows } = await pool.query(`
    SELECT v.*, u.tg_id as employer_tg_id 
    FROM vacancies v
    JOIN users u ON v.user_id = u.tg_id
    WHERE v.id = $1
  `, [vacancyId]);

  if (rows.length === 0) return ctx.reply('Вакансия не найдена');

  const v = rows[0];
  const seeker = ctx.from;

  await bot.telegram.sendMessage(
    v.employer_tg_id,
    `🔔 Новый отклик на "${v.title}"!\n\n👤 ${seeker.first_name}\n🆔 @${seeker.username || 'нет username'}`
  );

  await ctx.answerCbQuery();
  await ctx.reply('✅ Отклик отправлен! Работодатель получит уведомление.');
});

bot.hears('🔍 Искать в другом городе', (ctx) => {
  ctx.reply(
    '📍 Выбери город:',
    Markup.keyboard([
      ['Семей', 'Алматы'],
      ['Астана', 'Шымкент'],
      ['⬅️ Назад']
    ]).resize()
  );
});

bot.hears('⬅️ Назад', (ctx) => mainMenu(ctx));

// Обработка текста — форма вакансии
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const step = ctx.session.step;

  if (!step) return;

  if (step === 'title') {
    ctx.session.vacancy.title = text;
    ctx.session.step = 'category';
    return ctx.reply(
      '📂 Шаг 2/4\n\nВыбери категорию:',
      Markup.keyboard([
        ['🍽 Кафе/Рестораны', '🏗 Стройка'],
        ['🏪 Магазин', '🚛 Склад/Логистика'],
        ['🔧 Сервис', '📦 Другое'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  if (step === 'category') {
    ctx.session.vacancy.category = text;
    ctx.session.step = 'city';
    return ctx.reply(
      '📍 Шаг 3/4\n\nВыбери город:',
      Markup.keyboard([
        ['Семей', 'Алматы'],
        ['Астана', 'Шымкент'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  if (step === 'salary') {
    ctx.session.vacancy.salary = text;
    ctx.session.step = null;

    const v = ctx.session.vacancy;

    // Сохраняем вакансию
    await pool.query(`
      INSERT INTO vacancies (user_id, title, category, city, salary, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
    `, [ctx.from.id, v.title, v.category, v.city, v.salary]);

    ctx.session.vacancy = {};

    return ctx.reply(
      `✅ Вакансия опубликована!\n\n💼 ${v.title}\n📂 ${v.category}\n📍 ${v.city}\n💰 ${v.salary}\n\nСоискатели уже могут её найти!`,
      Markup.keyboard([
        ['📢 Публикую вакансию'],
        ['⬅️ Назад']
      ]).resize()
    );
  }
});

module.exports = bot;