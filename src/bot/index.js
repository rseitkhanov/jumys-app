const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const { pool } = require('../db/index');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

const saveUser = async (tg_id, first_name) => {
  await pool.query(`
    INSERT INTO users (tg_id, first_name)
    VALUES ($1, $2)
    ON CONFLICT (tg_id) DO NOTHING
  `, [tg_id, first_name]);
};

const mainMenu = (ctx) => {
  ctx.session.step = null;
  ctx.session.vacancy = {};
  const name = ctx.from.first_name;
  ctx.reply(
    `👋 Привет, ${name}!\n\nДобро пожаловать в SattyJob — работа по Казахстану.\n\nКто ты?`,
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

bot.hears('📢 Публикую вакансию', async (ctx) => {
  await pool.query(`UPDATE users SET role = 'employer' WHERE tg_id = $1`, [ctx.from.id]);
  ctx.session.step = 'title';
  ctx.session.vacancy = {};
  ctx.reply(
    '💼 Шаг 1/9\n\nНапиши должность:\nНапример: Повар, Грузчик, Продавец-консультант',
    Markup.keyboard([['⬅️ Назад']]).resize()
  );
});

// Города для соискателя
const cities = ['Семей', 'Алматы', 'Астана', 'Шымкент'];
cities.forEach(city => {
  bot.hears(city, async (ctx) => {
    if (ctx.session.step === 'city') {
      ctx.session.vacancy.city = city;
      ctx.session.step = 'district';
      return ctx.reply(
        '📍 Шаг 4/9\n\nНапиши район работы:\nНапример: Центр, Левый берег, Заречный',
        Markup.keyboard([['Не указывать'], ['⬅️ Назад']]).resize()
      );
    }

    // Соискатель
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
        Markup.keyboard([['🔍 Искать в другом городе'], ['⬅️ Назад']]).resize()
      );
    }

    await ctx.reply(`📋 Вакансии в городе ${city}:`);
    for (const v of rows) {
      const urgent = v.is_urgent ? '🔴 СРОЧНО\n' : '';
      const salary = v.salary || 'Договорная';
      const company = v.company ? `🏢 ${v.company}\n` : '';
      const district = v.district && v.district !== 'Не указывать' ? `📍 ${v.district}\n` : '';
      const schedule = v.schedule ? `🕐 ${v.schedule}\n` : '';
      const employment = v.employment_type ? `📋 ${v.employment_type}\n` : '';
      const payment = v.payment_frequency ? `💳 Выплаты: ${v.payment_frequency}\n` : '';
      const food = v.food ? '🍽 Питание: есть\n' : '';
      const transport = v.transport ? '🚌 Развозка: есть\n' : '';

      await ctx.reply(
        `${urgent}💼 ${v.title}\n${company}${district}💰 ${salary}\n${schedule}${employment}${payment}${food}${transport}📂 ${v.category || 'Без категории'}`,
        Markup.inlineKeyboard([
          Markup.button.callback('📞 Откликнуться', `apply_${v.id}`)
        ])
      );
    }
  });
});

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

// Форма вакансии — обработка текста
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const step = ctx.session.step;
  if (!step) return;

  // Шаг 1 — должность
  if (step === 'title') {
    ctx.session.vacancy.title = text;
    ctx.session.step = 'company';
    return ctx.reply(
      '🏢 Шаг 2/9\n\nНазвание компании (необязательно):',
      Markup.keyboard([['Не указывать'], ['⬅️ Назад']]).resize()
    );
  }

  // Шаг 2 — компания
  if (step === 'company') {
    ctx.session.vacancy.company = text === 'Не указывать' ? null : text;
    ctx.session.step = 'category';
    return ctx.reply(
      '📂 Шаг 3/9\n\nВыбери категорию:',
      Markup.keyboard([
        ['🍽 Кафе/Рестораны', '🏗 Стройка'],
        ['🏪 Магазин', '🚛 Склад/Логистика'],
        ['🔧 Сервис', '📦 Другое'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  // Шаг 3 — категория
  if (step === 'category') {
    ctx.session.vacancy.category = text;
    ctx.session.step = 'city';
    return ctx.reply(
      '📍 Шаг 4/9 — Выбери город:',
      Markup.keyboard([
        ['Семей', 'Алматы'],
        ['Астана', 'Шымкент'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  // Шаг 4 — район (после города)
  if (step === 'district') {
    ctx.session.vacancy.district = text === 'Не указывать' ? null : text;
    ctx.session.step = 'salary';
    return ctx.reply(
      '💰 Шаг 5/9\n\nУкажи зарплату:\nНапример: 150 000 тг, от 200 000 тг',
      Markup.keyboard([['Договорная'], ['⬅️ Назад']]).resize()
    );
  }

  // Шаг 5 — зарплата
  if (step === 'salary') {
    ctx.session.vacancy.salary = text;
    ctx.session.step = 'schedule';
    return ctx.reply(
      '🕐 Шаг 6/9\n\nГрафик работы:',
      Markup.keyboard([
        ['Полный день', 'Частичная занятость'],
        ['Сменный', 'Вахта'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  // Шаг 6 — график
  if (step === 'schedule') {
    ctx.session.vacancy.schedule = text;
    ctx.session.step = 'payment_frequency';
    return ctx.reply(
      '💳 Шаг 7/9\n\nПериодичность выплат:',
      Markup.keyboard([
        ['Еженедельно', '2 раза в месяц'],
        ['Ежемесячно', 'Договорная'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  // Шаг 7 — выплаты
  if (step === 'payment_frequency') {
    ctx.session.vacancy.payment_frequency = text;
    ctx.session.step = 'employment_type';
    return ctx.reply(
      '📋 Шаг 8/9\n\nТрудоустройство:',
      Markup.keyboard([
        ['Официальное', 'Неофициальное'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  // Шаг 8 — трудоустройство
  if (step === 'employment_type') {
    ctx.session.vacancy.employment_type = text;
    ctx.session.step = 'extras';
    return ctx.reply(
      '🎁 Шаг 9/9\n\nДополнительные условия:',
      Markup.keyboard([
        ['🍽 Питание + 🚌 Развозка'],
        ['🍽 Только питание'],
        ['🚌 Только развозка'],
        ['Ничего из этого'],
        ['⬅️ Назад']
      ]).resize()
    );
  }

  // Шаг 9 — доп условия
  if (step === 'extras') {
    ctx.session.vacancy.food = text.includes('Питание');
    ctx.session.vacancy.transport = text.includes('Развозка');
    ctx.session.step = null;

    const v = ctx.session.vacancy;

    await pool.query(`
      INSERT INTO vacancies 
        (user_id, title, company, category, city, district, salary, schedule, payment_frequency, employment_type, food, transport, status)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
    `, [
      ctx.from.id, v.title, v.company, v.category,
      v.city, v.district, v.salary, v.schedule,
      v.payment_frequency, v.employment_type,
      v.food, v.transport
    ]);

    ctx.session.vacancy = {};

    const district = v.district ? `📍 ${v.district}\n` : '';
    const company = v.company ? `🏢 ${v.company}\n` : '';
    const food = v.food ? '🍽 Питание: есть\n' : '';
    const transport = v.transport ? '🚌 Развозка: есть\n' : '';

    return ctx.reply(
      `✅ Вакансия опубликована!\n\n💼 ${v.title}\n${company}${district}📂 ${v.category}\n🏙 ${v.city}\n💰 ${v.salary}\n🕐 ${v.schedule}\n💳 ${v.payment_frequency}\n📋 ${v.employment_type}\n${food}${transport}\nСоискатели уже могут её найти!`,
      Markup.keyboard([
        ['📢 Публикую вакансию'],
        ['⬅️ Назад']
      ]).resize()
    );
  }
});

module.exports = bot;