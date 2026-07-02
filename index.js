require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const axios = require('axios');
const cron = require('node-cron');
const { MongoClient } = require('mongodb');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Twilio setup
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
const MY_WHATSAPP_NUMBER = `whatsapp:${process.env.MY_PHONE_NUMBER}`;

// Groq setup
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// MongoDB setup
let db;
let mongoClient;
let useMemory = false;

// In-memory fallback
const memoryStore = {
  userId: 'muiz',
  todoList: [],
  tomorrowTodos: [],
  habits: [],
  ideas: [],
  expenses: [],
  weeklyGoals: [],
  conversationHistory: [],
  focusMode: false,
  businessStats: { clipcast: [], glitters: [] }
};

async function connectDB() {
  console.log("Attempting MongoDB connection...");
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    await mongoClient.connect();
    db = mongoClient.db('alfred');
    console.log('Connected to MongoDB success!');
    useMemory = false;
  } catch (error) {
    console.error("MongoDB failed, using memory:", error.message);
    useMemory = true;
  }
}

// Get user data from DB
async function getUserData() {
  if (useMemory || !db) {
    return JSON.parse(JSON.stringify(memoryStore));
  }
  try {
    const data = await db.collection('userdata').findOne({ userId: 'muiz' });
    if (data) return data;
    return {
      userId: 'muiz',
      todoList: [],
      tomorrowTodos: [],
      habits: [],
      ideas: [],
      expenses: [],
      weeklyGoals: [],
      conversationHistory: [],
      focusMode: false,
      businessStats: { clipcast: [], glitters: [] }
    };
  } catch (error) {
    console.error('Error getting user data:', error.message);
    return JSON.parse(JSON.stringify(memoryStore));
  }
}

// Save user data to DB
async function saveUserData(data) {
  if (useMemory || !db) {
    Object.assign(memoryStore, data);
    return;
  }
  try {
    await db.collection('userdata').updateOne(
      { userId: 'muiz' },
      { $set: data },
      { upsert: true }
    );
  } catch (error) {
    console.error('Error saving user data:', error.message);
    Object.assign(memoryStore, data);
  }
}

// Send WhatsApp message
async function sendMessage(to, message) {
  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: to,
      body: message
    });
    console.log(`Message sent to ${to}`);
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Get AI response
async function getAIResponse(userMessage, context = '', userState) {
  try {
    const systemPrompt = `You are Muiz's personal AI assistant on WhatsApp. Your name is "Alfred". You have a sharp, witty and intelligent personality. You speak ONLY in clear, confident English — no Pidgin, no Naija slang, no "Oga", nothing like that at all. Think of yourself as a smart, friendly and slightly humorous personal assistant. You are encouraging, direct and fun to talk to. You roast Muiz gently when he is slacking and hype him up when he is winning.

Key things about Muiz:
- He's an entrepreneur in Lagos running ClipCast (SaaS for TikTok posting) and Glitters Photo Lab
- He's ambitious, hustling, and building multiple things at once
- He likes crypto and trading
- He appreciates humor and banter

Current state:
- Todo list: ${JSON.stringify(userState.todoList)}
- Tomorrow's todos: ${JSON.stringify(userState.tomorrowTodos)}
- Weekly goals: ${JSON.stringify(userState.weeklyGoals)}
- Habits: ${JSON.stringify(userState.habits)}
- Focus mode: ${userState.focusMode}
- Recent ideas: ${JSON.stringify(userState.ideas.slice(-3))}
- Business stats: ${JSON.stringify(userState.businessStats)}

${context}

Rules:
- Keep responses concise and punchy — this is WhatsApp not an essay
- Use emojis naturally
- Speak ONLY in clear English — no Pidgin or Naija slang at all
- Be encouraging but call him out when needed
- Never be too formal`;

    const history = (userState.conversationHistory || []).slice(-10).map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content
    }));

    const response = await axios.post(GROQ_URL, {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
      ],
      max_tokens: 500,
      temperature: 0.9
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Groq error:', error?.response?.data || error.message);
    return "My brain malfunctioned for a second! Try again 😅";
  }
}

// Handle commands
async function handleCommand(message, from) {
  const msg = message.toLowerCase().trim();
  let userState = await getUserData();

  let reply = '';

  // TODO commands
  if (msg.includes('add to my list') || msg.includes('add to list') || msg.startsWith('todo:')) {
    const task = message.replace(/add to (my )?list|todo:/gi, '').trim();
    userState.todoList.push({ task, done: false, addedAt: new Date() });
    reply = `✅ Added to your list: "${task}"\n\nYou now have ${userState.todoList.length} task(s). Let's get it done! 💪`;
  }

  else if (msg === 'my list' || msg === 'show list' || msg === 'list') {
    if (userState.todoList.length === 0) reply = "Your list is empty! Add something with 'add to my list: [task]' 📋";
    else {
      const list = userState.todoList.map((t, i) => `${t.done ? '✅' : '⬜'} ${i + 1}. ${t.task}`).join('\n');
      reply = `📋 *Your To-Do List:*\n\n${list}`;
    }
  }

  else if (msg.startsWith('done ') || msg.startsWith('completed ')) {
    const num = parseInt(msg.replace(/done |completed /gi, '').trim()) - 1;
    if (userState.todoList[num]) {
      userState.todoList[num].done = true;
      const remaining = userState.todoList.filter(t => !t.done).length;
      reply = `🎉 "${userState.todoList[num].task}" — done! ${remaining} more to go. Keep pushing! 💪`;
    } else reply = "I couldn't find that task number. Try 'done 1' for the first task 👀";
  }

  else if (msg.includes('clear list') || msg.includes('reset list')) {
    userState.todoList = [];
    reply = "List cleared! Fresh start — what are we tackling? 🧹";
  }

  // Tomorrow's plan
  else if (msg.includes('tomorrow') && (msg.includes('plan') || msg.includes('list') || msg.includes('todo'))) {
    const tasks = message.replace(/tomorrow'?s? (plan|list|todo|tasks?)?:?/gi, '').trim();
    if (tasks) {
      userState.tomorrowTodos = tasks.split(',').map(t => ({ task: t.trim(), done: false }));
      reply = `🔒 Tomorrow's plan locked in:\n\n${userState.tomorrowTodos.map((t, i) => `${i + 1}. ${t.task}`).join('\n')}\n\nI'll remind you first thing tomorrow morning! 💪`;
    }
  }

  // Idea vault
  else if (msg.startsWith('idea:') || msg.includes('save idea') || msg.includes('new idea')) {
    const idea = message.replace(/idea:|save idea|new idea/gi, '').trim();
    userState.ideas.push({ idea, savedAt: new Date() });
    reply = `💡 Idea saved to your vault!\n\n"${idea}"\n\nYou now have ${userState.ideas.length} idea(s) stored 🔐`;
  }

  else if (msg.includes('my ideas') || msg.includes('show ideas')) {
    if (userState.ideas.length === 0) reply = "No ideas saved yet! Use 'idea: [your idea]' to save one 💡";
    else {
      const list = userState.ideas.map((i, idx) => `${idx + 1}. ${i.idea}`).join('\n');
      reply = `💡 *Your Idea Vault:*\n\n${list}`;
    }
  }

  // Expense tracking
  else if (msg.startsWith('spent') || msg.startsWith('expense:')) {
    const amount = message.match(/\d+/)?.[0];
    const desc = message.replace(/spent|expense:/gi, '').replace(/\d+/g, '').trim();
    if (amount) {
      userState.expenses.push({ amount: parseInt(amount), description: desc, date: new Date() });
      const total = userState.expenses.reduce((sum, e) => sum + e.amount, 0);
      reply = `💸 Logged: ₦${parseInt(amount).toLocaleString()} on ${desc || 'something'}\n\nTotal spent so far: ₦${total.toLocaleString()}`;
    }
  }

  else if (msg.includes('my expenses') || msg.includes('spending')) {
    if (userState.expenses.length === 0) reply = "No expenses logged yet! Track with 'spent 5000 on data' 💰";
    else {
      const total = userState.expenses.reduce((sum, e) => sum + e.amount, 0);
      const list = userState.expenses.slice(-5).map(e => `• ₦${e.amount.toLocaleString()} — ${e.description}`).join('\n');
      reply = `💰 *Recent Expenses:*\n\n${list}\n\n*Total: ₦${total.toLocaleString()}*`;
    }
  }

  // Business stats
  else if (msg.includes('clipcast') && (msg.includes('signup') || msg.includes('update') || msg.includes('stats'))) {
    const num = message.match(/\d+/)?.[0];
    if (num) {
      userState.businessStats.clipcast.push({ signups: parseInt(num), date: new Date() });
      reply = `📊 ClipCast update logged: ${num} signup(s) today! The hustle is paying off 🚀`;
    }
  }

  else if (msg.includes('glitters') && (msg.includes('order') || msg.includes('update') || msg.includes('stats'))) {
    const num = message.match(/\d+/)?.[0];
    if (num) {
      userState.businessStats.glitters.push({ orders: parseInt(num), date: new Date() });
      reply = `📊 Glitters update logged: ${num} order(s) today! Photo lab is moving 📸`;
    }
  }

  // Focus mode
  else if (msg.includes('focus mode') || msg.includes('focus for')) {
    const hours = message.match(/(\d+)\s*hour/)?.[1] || 2;
    userState.focusMode = true;
    setTimeout(async () => {
      const state = await getUserData();
      state.focusMode = false;
      await saveUserData(state);
      sendMessage(from, `⏰ Time's up! Your ${hours} hour focus session is done.\n\nWhat did you accomplish? Tell me! 😄`);
    }, hours * 60 * 60 * 1000);
    reply = `🎯 Focus mode activated for ${hours} hour(s)!\n\nHead down, grind time. I'll check back in when you're done 💪`;
  }

  else if (msg === 'stop focus' || msg === 'focus off') {
    userState.focusMode = false;
    reply = "Focus mode off! Welcome back 😄";
  }

  // Weekly goals
  else if (msg.includes('weekly goal') || msg.includes('goals for this week')) {
    const goals = message.replace(/weekly goals?|goals for this week:?/gi, '').trim();
    if (goals) {
      userState.weeklyGoals = goals.split(',').map(g => ({ goal: g.trim(), done: false }));
      reply = `🎯 *Weekly Goals Locked In:*\n\n${userState.weeklyGoals.map((g, i) => `${i + 1}. ${g.goal}`).join('\n')}\n\nI'll review these with you on Friday. No excuses! 😄`;
    }
  }

  // Habit tracking
  else if (msg.startsWith('habit:') || msg.includes('add habit')) {
    const habit = message.replace(/habit:|add habit/gi, '').trim();
    userState.habits.push({ habit, streak: 0, lastDone: null });
    reply = `🏆 Habit added: "${habit}"\n\nI'll check in on this every evening! Consistency is everything 💪`;
  }

  else if (msg.includes('did my habits') || msg.includes('habits done')) {
    userState.habits = userState.habits.map(h => ({ ...h, streak: h.streak + 1, lastDone: new Date() }));
    reply = `🔥 Habits marked done! Your streaks:\n\n${userState.habits.map(h => `• ${h.habit}: ${h.streak} day(s) 🔥`).join('\n')}\n\nKeep it up! 💪`;
  }

  // Scheduled reminder
  else if (msg.includes('remind me') && msg.includes('at')) {
    reply = `⏰ Scheduled reminders are coming in the next update!\n\nFor now, tell me what you need to remember and I'll make note of it 📝`;
  }

  // Help
  else if (msg === 'help' || msg === 'commands') {
    reply = `🤖 *Alfred's Command List:*

📋 *To-Do:*
• "add to my list: [task]"
• "my list"
• "done 1"
• "clear list"

🌅 *Tomorrow:*
• "tomorrow plan: task1, task2"

💡 *Ideas:*
• "idea: [your idea]"
• "my ideas"

💸 *Money:*
• "spent 5000 on data"
• "my expenses"

📊 *Business:*
• "clipcast 3 signups today"
• "glitters 2 orders today"

🎯 *Focus:*
• "focus mode 2 hours"
• "stop focus"

🏆 *Habits:*
• "habit: [habit name]"
• "did my habits"

🎯 *Goals:*
• "weekly goals: goal1, goal2"

Or just chat with me normally! 😄`;
  }

  // Default — send to AI
  else {
    reply = await getAIResponse(message, '', userState);
    // Update conversation history
    userState.conversationHistory = userState.conversationHistory || [];
    userState.conversationHistory.push({ role: 'user', content: message });
    userState.conversationHistory.push({ role: 'model', content: reply });
    if (userState.conversationHistory.length > 20) {
      userState.conversationHistory = userState.conversationHistory.slice(-20);
    }
  }

  await saveUserData(userState);
  return reply;
}

// Webhook
app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || '';
  console.log(`Message from ${from}: ${incomingMsg}`);

  const userState = await getUserData();

  if (userState.focusMode && !incomingMsg.toLowerCase().includes('stop focus') && !incomingMsg.toLowerCase().includes('urgent')) {
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>You're in focus mode! Send "stop focus" if you need me 🎯</Message></Response>`);
    return;
  }

  try {
    const reply = await handleCommand(incomingMsg, from);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`);
  } catch (error) {
    console.error('Webhook error:', error);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Something went wrong, try again! 😅</Message></Response>`);
  }
});

app.get('/', (req, res) => res.send('Alfred WhatsApp Bot is running! 🚀'));

// ============ SCHEDULED MESSAGES ============

cron.schedule('0 6 * * *', async () => {
  const userState = await getUserData();
  const todos = userState.tomorrowTodos.length > 0 ? userState.tomorrowTodos : userState.todoList.filter(t => !t.done);
  const taskList = todos.length > 0 ? todos.map((t, i) => `${i + 1}. ${t.task}`).join('\n') : 'No tasks set! Add some with "add to my list: [task]"';
  if (userState.tomorrowTodos.length > 0) {
    userState.todoList = userState.tomorrowTodos;
    userState.tomorrowTodos = [];
    await saveUserData(userState);
  }
  await sendMessage(MY_WHATSAPP_NUMBER, `🌅 Good morning Muiz!\n\nAnother day to build something great 🏆\n\n📋 *Today's Tasks:*\n${taskList}\n\nLet's get it! 💪`);
}, { timezone: 'Africa/Lagos' });

cron.schedule('0 11 * * *', async () => {
  const userState = await getUserData();
  const pending = userState.todoList.filter(t => !t.done).length;
  const done = userState.todoList.filter(t => t.done).length;
  await sendMessage(MY_WHATSAPP_NUMBER, `👀 Afternoon check-in!\n\n✅ Done: ${done}\n⬜ Remaining: ${pending}\n\nHow's the hustle going? 💪`);
}, { timezone: 'Africa/Lagos' });

cron.schedule('0 19 * * *', async () => {
  const userState = await getUserData();
  const done = userState.todoList.filter(t => t.done).length;
  const total = userState.todoList.length;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;
  let verdict = percentage === 100 ? '🏆 100%! Absolutely crushed it today!' : percentage >= 75 ? `💪 ${percentage}% — solid day!` : percentage >= 50 ? `😅 ${percentage}% — decent, but we can do better!` : `😂 ${percentage}%... We need to talk tomorrow!`;
  await sendMessage(MY_WHATSAPP_NUMBER, `🌙 *Evening Recap*\n\n${verdict}\n\n✅ ${done}/${total} tasks completed\n\nPlan tomorrow — what's on the agenda? 📋`);
}, { timezone: 'Africa/Lagos' });

cron.schedule('0 20 * * *', async () => {
  await sendMessage(MY_WHATSAPP_NUMBER, `📅 Tomorrow is loading... What's the plan? Send me your task list and I'll lock it in! 🔒`);
}, { timezone: 'Africa/Lagos' });

cron.schedule('30 20 * * *', async () => {
  const userState = await getUserData();
  if (userState.habits.length > 0) {
    const habitList = userState.habits.map(h => `• ${h.habit} (streak: ${h.streak} days 🔥)`).join('\n');
    await sendMessage(MY_WHATSAPP_NUMBER, `🏆 *Daily Habit Check!*\n\n${habitList}\n\nDid you do all of them today? Reply "did my habits" to update your streak! 💪`);
  }
}, { timezone: 'Africa/Lagos' });

cron.schedule('30 6 * * 1', async () => {
  await sendMessage(MY_WHATSAPP_NUMBER, `🎯 *Monday Morning! New Week!*\n\nWhat are your 3 main goals for this week?\n\nSend: "weekly goals: goal1, goal2, goal3"\n\nLet's make this week count! 🔥`);
}, { timezone: 'Africa/Lagos' });

cron.schedule('0 17 * * 5', async () => {
  const userState = await getUserData();
  if (userState.weeklyGoals.length > 0) {
    const goalList = userState.weeklyGoals.map((g, i) => `${g.done ? '✅' : '❓'} ${i + 1}. ${g.goal}`).join('\n');
    await sendMessage(MY_WHATSAPP_NUMBER, `📊 *Friday Review!*\n\n${goalList}\n\nHow many did you actually complete? Be honest! 😄`);
  }
}, { timezone: 'Africa/Lagos' });

cron.schedule('0 9 * * 0', async () => {
  const userState = await getUserData();
  if (userState.ideas.length > 0) {
    const list = userState.ideas.slice(-5).map((i, idx) => `${idx + 1}. ${i.idea}`).join('\n');
    await sendMessage(MY_WHATSAPP_NUMBER, `💡 *Weekly Idea Review!*\n\nHere are your recent ideas:\n\n${list}\n\nWhich one is worth pursuing this week? 🧠`);
  }
}, { timezone: 'Africa/Lagos' });

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Alfred WhatsApp Bot running on port ${PORT} 🚀`);
    console.log('Waiting for messages...');
  });
});
