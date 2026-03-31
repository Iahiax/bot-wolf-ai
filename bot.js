// ═══════════════════════════════════════════════════════════════
//  Wolf Language Bot  —  High-Speed Edition
//  منصة Wolf Live | Gemini Flash | Node.js ESM
// ═══════════════════════════════════════════════════════════════
import { WOLF } from 'wolf.js';
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ───────────────────────────────────────────────────────────────
//  Gemini AI  — أسرع نموذج متاح
// ───────────────────────────────────────────────────────────────
const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || 'dummy',
  httpOptions: { apiVersion: '', baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || undefined },
});
const MODEL = 'gemini-3-flash-preview'; // أسرع نموذج

/** استدعاء Gemini بأقل عدد توكينز */
async function ask(prompt, maxTokens = 512) {
  const r = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { maxOutputTokens: maxTokens },
  });
  return (r.text || '').trim();
}

/** استخراج JSON من الرد */
function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// ───────────────────────────────────────────────────────────────
//  بيانات اللاعبين  — مخزّنة في الذاكرة + ملف JSON
// ───────────────────────────────────────────────────────────────
const DATA_FILE = join(__dirname, 'data', 'players.json');
mkdirSync(join(__dirname, 'data'), { recursive: true });

let players = {};
try { players = JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch {}

let saveTimer = null;
function scheduleSave() {
  // حفظ غير متزامن مع تجميع (debounce) لتقليل عمليات القرص
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFileSync(DATA_FILE, JSON.stringify(players), 'utf8'), 2000);
}

function getPlayer(id, nick, chId) {
  const k = String(id), ck = String(chId);
  if (!players[k]) players[k] = { id, nickname: nick || 'مجهول', totalPoints: 0, channels: {} };
  if (nick) players[k].nickname = nick;
  if (!players[k].channels[ck]) players[k].channels[ck] = 0;
  return players[k];
}

function addPoints(id, nick, chId, pts) {
  if (pts <= 0) return;
  const p = getPlayer(id, nick, chId);
  p.totalPoints += pts;
  p.channels[String(chId)] += pts;
  scheduleSave();
}

// ───────────────────────────────────────────────────────────────
//  حالة الألعاب
// ───────────────────────────────────────────────────────────────
const games = {};           // games[channelId] = state
const AUTO_DELAY = 30000;   // 30 ثانية للوضع التلقائي

// ───────────────────────────────────────────────────────────────
//  كشف الأوامر  — REGEX محلي فوري (بدون AI)
//  يدعم العربية + الإنجليزية + أي بادئة مشتركة
// ───────────────────────────────────────────────────────────────

/*
  بنية الرسالة:
    !<keyword> [args...]   ← أوامر عامة
    &<text>                ← إجابة على لعبة

  المفاتيح المعرّفة (أي ترجمة/هجاء مقبول):
    معنى / meaning / définition / 意思 / значение / bedeutung / significado / …
    ترجمه / translate / traduire / 翻译 / перевод / übersetzen / traducir / …
    بدء / start / démarrer / 开始 / начать / starten / iniciar / …
    تالي / next / suivant / 下一个 / следующий / nächste / siguiente / …
    مجموع / score / points / …
    مساعده / help / aide / 帮助 / …
    تلقائي / auto / automatique / 自动 / авто / …
*/

// مفاتيح regex لكل معنى
const RX = {
  meaning   : /^!(معنى|meaning|significa(?:do|t)|d[eé]finition|意思|значение|bedeutung|ma'na|anlamı|معني|māne|अर्थ|अर्थ|معنا)\s+(.+)/iu,
  translate : /^!(ترجم[هة]?|translate|translat|traduire|traducir|traduzir|перевод|übersetz|翻译|çeviri|ترجمه|翻訳)\s+(.+)/iu,
  help      : /^!(لغه?\s*مساعد[هة]?|help|aide|hilfe|ayuda|помощь|帮助|yardım|yardim|语言帮助|lang\s*help)/iu,
  score     : /^!(لغه?\s*مجموع?|my\s*score|score|نقاط|points|punkty|puan|分数|очки|язык\s*счёт)/iu,
  ch_rank   : /^!(لغه?\s*ترتيب\s*قناه?|channel\s*rank(?:ing)?|rang\s*canal|ranking\s*canal|频道排名|рейтинг\s*канала)/iu,
  gl_rank   : /^!(لغه?\s*ترتيب\s*ولف|global\s*rank(?:ing)?|wolf\s*rank(?:ing)?|全球排名|глобальный\s*рейтинг)/iu,
  auto      : /^!(لغه?\s*تلقائي|auto\s*mode?|mode\s*auto|автоматически|自动模式|otomatik)/iu,
  next      : /^!(لغه?\s*[تt]الي|next|suivant|nächste|siguiente|下一个|следующий|sonraki)/iu,

  // ألعاب
  game_guess: /^!(كلمات\s*المعاني|guess\s*word|deviner\s*mot|猜词|угадать\s*слово|wort\s*erraten|adivinar\s*palabra)\s*(بدء|start|démarrer|开始|начать|starten|iniciar)?$/iu,
  game_word : /^!(معاني\s*الكلمات?|word\s*meaning|词义|смысл\s*слова|bedeutung\s*wort|significado\s*palabra)\s*(بدء|start|démarrer|开始|начать|starten|iniciar)?$/iu,
  game_parse: /^!(اعرب?|إعراب|parse|parsing|syntaxe|语法分析|синтаксис|grammatik|análisis)\s*(الجمل[هة]?)?\s*(بدء|start|démarrer|开始|начать|starten|iniciar)?$/iu,

  // ألعاب الترجمة  →  !ترجمه كلمات/جمله/نص {من} {الى} بدء
  game_tr_w : /^!(ترجم[هة]?\s*كلمات?|translate\s*words?|traduire\s*mots?|翻译词语)\s+(\S+)\s+(\S+)(?:\s+(?:بدء|start|开始|начать))?$/iu,
  game_tr_s : /^!(ترجم[هة]?\s*جمل[هة]?|translate\s*sentence|traduire\s*phrase|翻译句子)\s+(\S+)\s+(\S+)(?:\s+(?:بدء|start|开始|начать))?$/iu,
  game_tr_t : /^!(ترجم[هة]?\s*نص?|translate\s*text|traduire\s*texte|翻译文本)\s+(\S+)\s+(\S+)(?:\s+(?:بدء|start|开始|начать))?$/iu,
};

/**
 * تحليل الرسالة محلياً بدون AI.
 * إذا لم يتطابق أي نمط، ترجع null ← يُحوَّل للـ AI.
 */
function localDetect(body) {
  let m;

  if ((m = body.match(RX.meaning)))
    return { cmd: 'MEANING', param: m[2].trim(), langFrom: '', langTo: '', lang: 'ar' };

  if ((m = body.match(RX.translate))) {
    // !ترجمه {اللغة} {النص...}
    const rest = m[2].trim();
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    return { cmd: 'TRANSLATE', langTo: rest.slice(0, sp), param: rest.slice(sp + 1).trim(), lang: 'ar' };
  }

  if (RX.help.test(body))     return { cmd: 'HELP' };
  if (RX.score.test(body))    return { cmd: 'SHOW_SCORE' };
  if (RX.ch_rank.test(body))  return { cmd: 'CHANNEL_RANK' };
  if (RX.gl_rank.test(body))  return { cmd: 'GLOBAL_RANK' };
  if (RX.auto.test(body))     return { cmd: 'TOGGLE_AUTO' };
  if (RX.next.test(body))     return { cmd: 'NEXT' };
  if (RX.game_guess.test(body)) return { cmd: 'GAME_GUESS_WORD', lang: 'ar' };
  if (RX.game_word.test(body))  return { cmd: 'GAME_WORD_MEANING', lang: 'ar' };
  if (RX.game_parse.test(body)) return { cmd: 'GAME_PARSE', lang: 'ar' };

  if ((m = body.match(RX.game_tr_w)))
    return { cmd: 'GAME_TRANSLATE_WORDS', langFrom: m[2], langTo: m[3], lang: 'ar' };
  if ((m = body.match(RX.game_tr_s)))
    return { cmd: 'GAME_TRANSLATE_SENTENCE', langFrom: m[2], langTo: m[3], lang: 'ar' };
  if ((m = body.match(RX.game_tr_t)))
    return { cmd: 'GAME_TRANSLATE_TEXT', langFrom: m[2], langTo: m[3], lang: 'ar' };

  return null; // لا يتطابق محلياً → يُرسل للـ AI
}

/** كشف AI فقط للأوامر غير العربية أو غير المعروفة */
async function aiDetect(body) {
  const r = await ask(
    `Bot command detector. Message: "${body.slice(0, 200)}"
Respond JSON only:
{"cmd":"MEANING|TRANSLATE|GAME_GUESS_WORD|GAME_WORD_MEANING|GAME_TRANSLATE_WORDS|GAME_TRANSLATE_SENTENCE|GAME_TRANSLATE_TEXT|GAME_PARSE|TOGGLE_AUTO|SHOW_SCORE|CHANNEL_RANK|GLOBAL_RANK|HELP|NEXT|NONE","param":"","langFrom":"","langTo":"","lang":"ar"}`,
    150,
  );
  try { return parseJSON(r) || { cmd: 'NONE' }; } catch { return { cmd: 'NONE' }; }
}

// ───────────────────────────────────────────────────────────────
//  فحص المحتوى المحظور (سريع)
// ───────────────────────────────────────────────────────────────
// قائمة محلية سريعة للكلمات الحساسة الواضحة
const BLOCKED_WORDS = /\b(sex|porn|nude|naked|politics|religion|allah|god|jesus|christ|prophet|quran|bible|isis|terror|bomb|kill|رقبة|قتل|إرهاب|داعش|سياسة|حكومة|ديانة|إباحي|جنسي)\b/i;

async function isForbidden(text) {
  if (BLOCKED_WORDS.test(text)) return true; // فلتر محلي فوري
  const r = await ask(`Is this text politically, religiously, or sexually offensive? "${text.slice(0, 200)}" Reply YES or NO only.`, 5);
  return r.toUpperCase().startsWith('Y');
}

// ───────────────────────────────────────────────────────────────
//  توليد أسئلة الألعاب
// ───────────────────────────────────────────────────────────────
async function genGuessWord(lang) {
  const r = await ask(`Random useful ${lang} word + definition. No politics/religion/adult. JSON:{"word":"","definition":"","difficulty":2}`, 120);
  return parseJSON(r);
}
async function genWordMeaning(lang) {
  const r = await ask(`Random useful ${lang} word + meaning. No politics/religion/adult. JSON:{"word":"","meaning":"","difficulty":2}`, 120);
  return parseJSON(r);
}
async function genTranslation(from, to, type) {
  const ct = type === 'GAME_TRANSLATE_WORDS' ? 'one word' : type === 'GAME_TRANSLATE_SENTENCE' ? 'one useful sentence/proverb' : '2-3 sentence paragraph';
  const r = await ask(`Pick ${ct} in ${from} for translation to ${to}. Cultural, no politics/religion/adult. JSON:{"content":"","translation":"","difficulty":2,"wordCount":1}`, 200);
  return parseJSON(r);
}
async function genParse(lang) {
  const r = await ask(`Pick a ${lang} grammatically rich sentence for parsing exercise. No politics/religion/adult. JSON:{"sentence":"","parsing":"","difficulty":3}`, 250);
  return parseJSON(r);
}

async function buildQuestion(type, langFrom, langTo, lang) {
  try {
    if (type === 'GAME_GUESS_WORD') {
      const q = await genGuessWord(lang);
      if (!q) return null;
      return { question: `🔤 ما الكلمة التي تعني: "${q.definition}"؟`, answer: q.word, difficulty: q.difficulty || 2, wordCount: 1 };
    }
    if (type === 'GAME_WORD_MEANING') {
      const q = await genWordMeaning(lang);
      if (!q) return null;
      return { question: `📖 اكتب معنى: "${q.word}"`, answer: q.meaning, difficulty: q.difficulty || 2, wordCount: 1 };
    }
    if (['GAME_TRANSLATE_WORDS', 'GAME_TRANSLATE_SENTENCE', 'GAME_TRANSLATE_TEXT'].includes(type)) {
      const q = await genTranslation(langFrom, langTo, type);
      if (!q) return null;
      return { question: `🌐 ترجم إلى ${langTo}: "${q.content}"`, answer: q.translation, difficulty: q.difficulty || 2, wordCount: q.wordCount || 1 };
    }
    if (type === 'GAME_PARSE') {
      const q = await genParse(lang);
      if (!q) return null;
      return { question: `📝 أعرب: (${q.sentence})`, answer: q.parsing, difficulty: q.difficulty || 3, wordCount: (q.sentence || '').split(' ').length };
    }
  } catch (e) { console.error('buildQuestion:', e.message); }
  return null;
}

// ───────────────────────────────────────────────────────────────
//  التحقق من الإجابة
// ───────────────────────────────────────────────────────────────
async function checkAnswer(question, correctAnswer, playerAnswer) {
  const r = await ask(
    `Lenient answer checker for language learning game.
Q: "${question.slice(0, 150)}"
Correct: "${correctAnswer.slice(0, 200)}"
Player: "${playerAnswer.slice(0, 200)}"
Accept near-correct answers. JSON:{"correct":true,"percentage":85}`,
    60,
  );
  try { return parseJSON(r) || { correct: false, percentage: 0 }; } catch { return { correct: false, percentage: 0 }; }
}

function calcPoints(pct, diff, wc) {
  return Math.max(Math.round((pct / 100) * 10) + (diff || 2) * 2 + Math.min(wc || 1, 10), 0);
}

// ───────────────────────────────────────────────────────────────
//  الرسائل الثابتة
// ───────────────────────────────────────────────────────────────
const MSG = {
  loading_meaning : { ar: '⏳ جاري البحث عن المعنى...', en: '⏳ Searching for meaning...' },
  loading_trans   : { ar: '⏳ جاري البحث عن الترجمه...', en: '⏳ Searching for translation...' },
  loading_game    : { ar: '🎮 جاري تحضير اللعبة...', en: '🎮 Preparing game...' },
  loading_check   : { ar: '📝 جاري فحص الاجابه ...', en: '📝 Checking answer...' },
  correct         : { ar: 'احسنت ✅ اجابه صحيحه بنسبة ({p}%) اكتسبت ({pts} نقطة)', en: '✅ Correct ({p}%) +{pts} points' },
  partial         : { ar: 'اجابه جزئيه ({p}%) اكتسبت ({pts} نقطة)', en: 'Partial ({p}%) +{pts} points' },
  wrong           : { ar: 'للأسف اجابتك خاطئه تماماً', en: 'Wrong answer' },
  auto_on         : { ar: 'الوضع التلقائي تم تفعيله ✅', en: 'Auto mode ON ✅' },
  auto_off        : { ar: 'الوضع التلقائي تم اغلاقه ❌', en: 'Auto mode OFF ❌' },
  my_score        : { ar: 'مجموعك {pts} نقطة', en: 'Your score: {pts} points' },
  ch_rank_hdr     : { ar: 'ترتيب القناة — أفضل 10:', en: 'Channel Ranking — Top 10:' },
  gl_rank         : { ar: 'ترتيبك على مستوى التطبيق هو {r}', en: 'Your global rank: {r}' },
  violation       : { ar: 'تحذير مخالفه ⚠️', en: 'Violation Warning ⚠️' },
  no_game         : { ar: 'لا توجد لعبة نشطة', en: 'No active game' },
  game_err        : { ar: '❌ خطأ في تحضير اللعبة، حاول مرة أخرى.', en: '❌ Game error, please try again.' },
  help: {
    ar: `مرحباً! بوت اللغات بالذكاء الاصطناعي 🤖
للإجابة على الألعاب ابدأ برمز & مثال: &كلمتي
• !معنى {كلمة} — معنى الكلمة أو الجملة
• !ترجمه {اللغة} {النص} — ترجمة إلى أي لغة
• !كلمات المعاني بدء — لعبة خمن الكلمة 🔤
• !معاني الكلمات بدء — لعبة اشرح المعنى 📖
• !ترجمه كلمات {من} {إلى} بدء — ترجمة كلمات 🌐
• !ترجمه جمله {من} {إلى} بدء — ترجمة جملة 🌐
• !ترجمه نص {من} {إلى} بدء — ترجمة نص 🌐
• !اعرب الجمله بدء — لعبة الإعراب 📝
• !لغه تلقائي — تشغيل/إيقاف الوضع التلقائي
• !لغه التالي — السؤال التالي ⏭️
• !لغه مجموع — نقاطك 🏆
• !لغه ترتيب قناه — ترتيب القناة
• !لغه ترتيب ولف — الترتيب العالمي 🌍
• !لغه مساعده — هذه القائمة`,
    en: `Hello! AI Language Bot 🤖
Start answers with & e.g: &myword
• !معنى {word} — word meaning
• !ترجمه {lang} {text} — translate
• !كلمات المعاني بدء — Guess Word game 🔤
• !معاني الكلمات بدء — Word Meaning game 📖
• !ترجمه كلمات {fr} {to} بدء — Word translate 🌐
• !ترجمه جمله {fr} {to} بدء — Sentence translate 🌐
• !ترجمه نص {fr} {to} بدء — Text translate 🌐
• !اعرب الجمله بدء — Parse game 📝
• !لغه تلقائي — Auto mode toggle
• !لغه التالي — Next question ⏭️
• !لغه مجموع — Your score 🏆
• !لغه ترتيب قناه — Channel rank
• !لغه ترتيب ولف — Global rank 🌍
• !لغه مساعده — This help`,
  },
};

function m(key, lang, vars = {}) {
  const tpl = (MSG[key]?.[lang] || MSG[key]?.ar || '');
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// ───────────────────────────────────────────────────────────────
//  إدارة الألعاب
// ───────────────────────────────────────────────────────────────
async function startGame(chId, type, langFrom, langTo, lang, reply) {
  const ck = String(chId);
  if (games[ck]?.autoTimer) clearTimeout(games[ck].autoTimer);

  games[ck] = {
    type, langFrom, langTo, lang: lang || 'ar',
    question: null, answer: null,
    difficulty: 2, wordCount: 1, nextQ: null,
    autoMode: games[ck]?.autoMode || false, autoTimer: null,
  };

  // إرسال رسالة التحضير + توليد السؤال الحالي والتالي بشكل متوازٍ
  const [,, q, nextQ] = await Promise.all([
    reply(`/me ${m('loading_game', lang)}`),
    Promise.resolve(), // placeholder
    buildQuestion(type, langFrom, langTo, lang),
    buildQuestion(type, langFrom, langTo, lang),
  ]);

  if (!q) { await reply(`/me ${m('game_err', lang)}`); delete games[ck]; return; }

  Object.assign(games[ck], { question: q.question, answer: q.answer, difficulty: q.difficulty, wordCount: q.wordCount, nextQ });
  await reply(`/me ${q.question}`);
}

async function nextQuestion(chId, reply) {
  const ck = String(chId);
  const st = games[ck];
  if (!st) return;

  if (st.autoTimer) { clearTimeout(st.autoTimer); st.autoTimer = null; }

  // إذا كان السؤال التالي جاهزاً → أرسله فوراً ثم حضّر الذي بعده في الخلفية
  const q = st.nextQ;
  if (q) {
    Object.assign(st, { question: q.question, answer: q.answer, difficulty: q.difficulty, wordCount: q.wordCount, nextQ: null });
    await reply(`/me ${q.question}`);
    // حضّر السؤال الذي بعده في الخلفية
    buildQuestion(st.type, st.langFrom, st.langTo, st.lang).then((nq) => { if (games[ck]) games[ck].nextQ = nq; });
  } else {
    await reply(`/me ${m('loading_game', st.lang)}`);
    const [nq, nnq] = await Promise.all([
      buildQuestion(st.type, st.langFrom, st.langTo, st.lang),
      buildQuestion(st.type, st.langFrom, st.langTo, st.lang),
    ]);
    if (!nq) { await reply(`/me ${m('game_err', st.lang)}`); return; }
    Object.assign(st, { question: nq.question, answer: nq.answer, difficulty: nq.difficulty, wordCount: nq.wordCount, nextQ: nnq });
    await reply(`/me ${nq.question}`);
  }

  if (st.autoMode) {
    st.autoTimer = setTimeout(() => nextQuestion(chId, reply), AUTO_DELAY);
  }
}

// ───────────────────────────────────────────────────────────────
//  البوت الرئيسي
// ───────────────────────────────────────────────────────────────
const client = new WOLF();

client.on('ready', () => console.log('✅ Wolf Bot يعمل | Gemini:', MODEL));

client.on('channelMessage', async (message) => {
  try {
    const body = (message.body || '').trim();
    if (!body) return;

    const chId = message.isGroup ? message.targetGroupId : null;
    if (!chId) return; // القنوات فقط

    const uid  = message.sourceSubscriberId;
    const ck   = String(chId);
    const lang = games[ck]?.lang || 'ar';

    // ─── دالة الرد المختصرة ───
    const reply = (txt) => message.reply(txt).catch((e) => console.error('reply err:', e.message));

    // ═══════════════════════════════
    //  إجابة (تبدأ بـ &)
    // ═══════════════════════════════
    if (body.startsWith('&')) {
      const ans = body.slice(1).trim();
      if (!ans) return;

      const st = games[ck];
      if (!st?.question) { reply(`/me ${m('no_game', lang)}`); return; }

      // الحصول على الاسم + فحص الإجابة بالتوازي
      const [sub, check] = await Promise.all([
        client.subscriber.getById(uid).catch(() => null),
        (reply(`/me ${m('loading_check', st.lang)}`), checkAnswer(st.question, st.answer, ans)),
      ]);
      const nick = sub?.nickname || '';
      const pts  = calcPoints(check.percentage, st.difficulty, st.wordCount);

      if (check.correct || check.percentage >= 75) {
        addPoints(uid, nick, chId, pts);
        await reply(`/me ${m('correct', st.lang, { p: check.percentage, pts })}`);
        await nextQuestion(chId, reply);
      } else if (check.percentage >= 30) {
        addPoints(uid, nick, chId, pts);
        await reply(`/me ${m('partial', st.lang, { p: check.percentage, pts })}`);
      } else {
        reply(`/alert ${m('wrong', st.lang)}`);
      }
      return;
    }

    // ═══════════════════════════════
    //  أوامر (تبدأ بـ !)
    // ═══════════════════════════════
    if (!body.startsWith('!')) return;

    // كشف سريع محلي أولاً
    let det = localDetect(body);

    // fallback للـ AI فقط عند الضرورة
    if (!det) {
      det = await aiDetect(body);
    }

    const { cmd, param, langFrom, langTo } = det || {};
    if (!cmd || cmd === 'NONE') return;

    // ─── الاسم (نحضّره فقط عند الحاجة لأوامر النقاط) ───
    const getNick = () => client.subscriber.getById(uid).then((s) => s?.nickname || '').catch(() => '');

    switch (cmd) {

      case 'MEANING': {
        if (!param) return;
        // فحص المحتوى + إرسال رسالة التحميل بشكل متوازٍ
        const [forbidden] = await Promise.all([
          isForbidden(param),
          reply(`/me ${m('loading_meaning', lang)}`),
        ]);
        if (forbidden) { reply(`/alert ${m('violation', lang)}`); return; }
        const meaning = await ask(`Meaning of "${param}" in the same language. No politics/religion/adult. Direct answer only.`, 400);
        reply(`/me ${meaning}`);
        break;
      }

      case 'TRANSLATE': {
        if (!param || !langTo) return;
        const [forbidden] = await Promise.all([
          isForbidden(param),
          reply(`/me ${m('loading_trans', lang)}`),
        ]);
        if (forbidden) { reply(`/alert ${m('violation', lang)}`); return; }
        const t = await ask(`Translate to ${langTo}: "${param}". If offensive write FORBIDDEN. Translation only, no explanation.`, 400);
        if (t.includes('FORBIDDEN')) { reply(`/alert ${m('violation', lang)}`); return; }
        reply(`/me ${t}`);
        break;
      }

      case 'GAME_GUESS_WORD':
        await startGame(chId, 'GAME_GUESS_WORD', lang, lang, lang, reply); break;

      case 'GAME_WORD_MEANING':
        await startGame(chId, 'GAME_WORD_MEANING', lang, lang, lang, reply); break;

      case 'GAME_TRANSLATE_WORDS':
        await startGame(chId, 'GAME_TRANSLATE_WORDS', langFrom || 'ar', langTo || 'en', lang, reply); break;

      case 'GAME_TRANSLATE_SENTENCE':
        await startGame(chId, 'GAME_TRANSLATE_SENTENCE', langFrom || 'ar', langTo || 'en', lang, reply); break;

      case 'GAME_TRANSLATE_TEXT':
        await startGame(chId, 'GAME_TRANSLATE_TEXT', langFrom || 'ar', langTo || 'en', lang, reply); break;

      case 'GAME_PARSE':
        await startGame(chId, 'GAME_PARSE', lang, lang, lang, reply); break;

      case 'TOGGLE_AUTO': {
        if (!games[ck]) games[ck] = { autoMode: false, autoTimer: null, lang };
        games[ck].autoMode = !games[ck].autoMode;
        if (games[ck].autoMode) {
          reply(`/me ${m('auto_on', lang)}`);
          if (games[ck].question)
            games[ck].autoTimer = setTimeout(() => nextQuestion(chId, reply), AUTO_DELAY);
        } else {
          if (games[ck].autoTimer) { clearTimeout(games[ck].autoTimer); games[ck].autoTimer = null; }
          reply(`/me ${m('auto_off', lang)}`);
        }
        break;
      }

      case 'NEXT': {
        if (!games[ck]?.question) { reply(`/me ${m('no_game', lang)}`); return; }
        await nextQuestion(chId, reply);
        break;
      }

      case 'SHOW_SCORE': {
        const nick = await getNick();
        const p = getPlayer(uid, nick, chId);
        reply(`/me ${m('my_score', lang, { pts: p.totalPoints })}`);
        break;
      }

      case 'CHANNEL_RANK': {
        const ranked = Object.values(players)
          .filter((p) => p.channels?.[ck] !== undefined)
          .sort((a, b) => (b.channels[ck] || 0) - (a.channels[ck] || 0))
          .slice(0, 10);
        const lines = ranked.length
          ? ranked.map((p, i) => `${i + 1}- ${p.nickname} (${p.id}) ${p.channels[ck]} نقطة`).join('\n')
          : '—';
        reply(`/me ${m('ch_rank_hdr', lang)}\n${lines}`);
        break;
      }

      case 'GLOBAL_RANK': {
        const nick = await getNick();
        getPlayer(uid, nick, chId);
        const sorted = Object.values(players).sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
        const rank = sorted.findIndex((p) => p.id === uid) + 1;
        reply(`/me ${m('gl_rank', lang, { r: rank || '—' })}`);
        break;
      }

      case 'HELP':
        reply(`/me ${m('help', lang)}`);
        break;
    }

  } catch (err) {
    console.error('Handler error:', err.message);
  }
});

client.login();
