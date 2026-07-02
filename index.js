require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const axios = require('axios');
const cron = require('node-cron');

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

// In-memory storage
const userState = {
  todoList: [],
  tomorrowTodos: [],
  habits: [],
  ideas: [],
  expenses: [],
  weeklyGoals: [],
  conversationHistory: [],
  focusMode: false,
  focusEndTime: null,
  scheduledMessages: [],
  moodLog: [],
  businessStats: { clipcast: [], glitters: [] }
};

// Send WhatsApp message
async function sendMessage(to, message) {
  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: to,
      body: message
    });
    console.log(`Message sent to ${to}: ${message}`);
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Get AI response with Naija personality
async function getAIResponse(userMessage, context = '') {
  try {
    const systemPrompt = `You are Muiz's personal AI assistant on WhatsApp. Your name is "Ade" (short for Adewale). You have a fun Naija personality — you use Nigerian expressions, Pidgin English naturally mixed with regular English, you're witty, you roast Muiz gently when he's slacking, and hype him up when he's winning. You're like his sharp Lagos friend who also happens to be super smart.

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
- Mix Naija expressions organically (e.g. "Oga", "e don do", "sharp sharp", "wahala", "na wa", "abeg")
- Be encouraging but call him out when needed
- For commands like adding todos, confirm clearly
- Never be too formal`;

    const history = userState.conversationHistory.slice(-10).map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content
    }));

    const response = await axios.post(GROQ_URL, {
      model: 'llama3-8b-8192',
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

    const reply = response.data.choices[0].message.content;

    // Update conversation history
    userState.conversationHistory.push({ role: 'user', content: userMessage });
    userState.conversationHistory.push({ role: 'model', content: reply });

    if (userState.conversationHistory.length > 20) {
      userState.conversationHistory = userState.conversationHistory.slice(-20);
    }

    return reply;
  } catch (error) {
    console.error('Groq error:', error?.response?.data || error.message);
    return "Oga my brain dey malfunction small 😅 Try again abeg!";
  }
}

// Parse commands from messages
async function handleCommand(message, from) {
  const msg = message.toLowerCase().trim();

  // TODO commands
  if (msg.includes('add to my list') || msg.includes('add to list') || msg.startsWith('todo:')) {
    const task = message.replace(/add to (my )?list|todo:/gi, '').trim();
    userState.todoList.push({ task, done: false, addedAt: new Date() });
    return `✅ Added to your list: "${task}"\n\nYour current list has ${userState.todoList.length} item(s). You go do am? 👀`;
  }

  if (msg.includes('my list') || msg.includes('show list') || msg === 'list') {
    if (userState.todoList.length === 0) return "Your list is empty oga 😅 Add something sharp sharp!";
    const list = userState.todoList.map((t, i) => `${t.done ? '✅' : '⬜'} ${i + 1}. ${t.task}`).join('\n');
    return `📋 *Your To-Do List:*\n\n${list}`;
  }

  if (msg.startsWith('done ') || msg.startsWith('completed ')) {
    const num = parseInt(msg.replace(/done |completed /gi, '').trim()) - 1;
    if (userState.todoList[num]) {
      userState.todoList[num].done = true;
      const remaining = userState.todoList.filter(t => !t.done).length;
      return `🎉 Oya! "${userState.todoList[num].task}" don land! ${remaining} more to go. You dey try oga! 💪`;
    }
    return "I no understand which number you mean. Try 'done 1' for the first task 👀";
  }

  if (msg.includes('clear list') || msg.includes('reset list')) {
    userState.todoList = [];
    return "List cleared! Fresh start oga 🧹 What we doing today?";
  }

  // Tomorrow's plan
  if (msg.includes('tomorrow') && (msg.includes('plan') || msg.includes('list') || msg.includes('todo'))) {
    const tasks = message.replace(/tomorrow'?s? (plan|list|todo|tasks?)?:?/gi, '').trim();
    if (tasks) {
      userState.tomorrowTodos = tasks.split(',').map(t => ({ task: t.trim(), done: false }));
      return `🔒 Locked in for tomorrow:\n\n${userState.tomorrowTodos.map((t, i) => `${i + 1}. ${t.task}`).join('\n')}\n\nI go remind you first thing tomorrow morning! 💪`;
    }
  }

  // Idea vault
  if (msg.startsWith('idea:') || msg.includes('save idea') || msg.includes('new idea')) {
    const idea = message.replace(/idea:|save idea|new idea/gi, '').trim();
    userState.ideas.push({ idea, savedAt: new Date() });
    return `💡 Idea saved to your vault!\n\n"${idea}"\n\nYou now have ${userState.ideas.length} idea(s) locked away 🔐`;
  }

  if (msg.includes('my ideas') || msg.includes('show ideas')) {
    if (userState.ideas.length === 0) return "No ideas saved yet oga! Drop something with 'idea: [your idea]' 💡";
    const list = userState.ideas.map((i, idx) => `${idx + 1}. ${i.idea}`).join('\n');
    return `💡 *Your Idea Vault:*\n\n${list}`;
  }

  // Expense tracking
  if (msg.startsWith('spent') || msg.startsWith('expense:')) {
    const amount = message.match(/\d+/)?.[0];
    const desc = message.replace(/spent|expense:/gi, '').replace(/\d+/g, '').trim();
    if (amount) {
      userState.expenses.push({ amount: parseInt(amount), description: desc, date: new Date() });
      const total = userState.expenses.reduce((sum, e) => sum + e.amount, 0);
      return `💸 Logged: ₦${parseInt(amount).toLocaleString()} on ${desc || 'something'}\n\nTotal spent so far: ₦${total.toLocaleString()}\n\nOga manage the money well o! 😅`;
    }
  }

  if (msg.includes('expenses') || msg.includes('spending')) {
    if (userState.expenses.length === 0) return "No expenses logged yet! Track am with 'spent 5000 on data' 💰";
    const total = userState.expenses.reduce((sum, e) => sum + e.amount, 0);
    const list = userState.expenses.slice(-5).map(e => `• ₦${e.amount.toLocaleString()} — ${e.description}`).join('\n');
    return `💰 *Recent Expenses:*\n\n${list}\n\n*Total: ₦${total.toLocaleString()}*`;
  }

  // Business stats
  if (msg.includes('clipcast') && (msg.includes('signup') || msg.includes('update') || msg.includes('stats'))) {
    const num = message.match(/\d+/)?.[0];
    if (num) {
      userState.businessStats.clipcast.push({ signups: parseInt(num), date: new Date() });
      return `📊 ClipCast update logged: ${num} signup(s) today! The hustle dey pay oga 🚀`;
    }
  }

  if (msg.includes('glitters') && (msg.includes('order') || msg.includes('update') || msg.includes('stats'))) {
    const num = message.match(/\d+/)?.[0];
    if (num) {
      userState.businessStats.glitters.push({ orders: parseInt(num), date: new Date() });
      return `📊 Glitters update logged: ${num} order(s) today! Photo lab dey move 📸`;
    }
  }

  // Focus mode
  if (msg.includes('focus mode') || msg.includes('focus for')) {
    const hours = message.match(/(\d+)\s*hour/)?.[1] || 2;
    userState.focusMode = true;
    userState.focusEndTime = new Date(Date.now() + hours * 60 * 60 * 1000);
    setTimeout(() => {
      userState.focusMode = false;
      sendMessage(from, `⏰ Oga time don reach! Your ${hours} hour focus session don end.\n\nWetin you achieve? Tell me make I judge you properly 😂`);
    }, hours * 60 * 60 * 1000);
    return `🎯 Focus mode activated for ${hours} hour(s)!\n\nI go leave you alone until ${userState.focusEndTime.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.\n\nNo distraction! Grind time 💪`;
  }

  if (msg === 'stop focus' || msg === 'focus off') {
    userState.focusMode = false;
    return "Focus mode off! Welcome back to the world oga 😄";
  }

  // Weekly goals
  if (msg.includes('weekly goal') || msg.includes('goals for this week')) {
    const goals = message.replace(/weekly goals?|goals for this week:?/gi, '').trim();
    if (goals) {
      userState.weeklyGoals = goals.split(',').map(g => ({ goal: g.trim(), done: false }));
      return `🎯 *Weekly Goals Locked In:*\n\n${userState.weeklyGoals.map((g, i) => `${i + 1}. ${g.goal}`).join('\n')}\n\nI go check you on Friday. No excuses oga! 😂`;
    }
  }

  // Mood check
  if (msg.startsWith('mood:') || msg.includes('feeling')) {
    const mood = message.replace(/mood:|i('?m| am) feeling/gi, '').trim();
    userState.moodLog.push({ mood, date: new Date() });
    const response = await getAIResponse(message, `User just reported their mood as: ${mood}. Respond with empathy and appropriate energy adjustment.`);
    return response;
  }

  // Scheduled message (basic)
  if (msg.includes('send') && msg.includes('at') && msg.includes('message')) {
    return `📅 Scheduled messaging feature is coming in the next update oga! For now I'll remind you instead.\n\nJust tell me: "Remind me at [time] to message [person] about [topic]" 👀`;
  }

  // Habit tracking
  if (msg.startsWith('habit:') || msg.includes('add habit')) {
    const habit = message.replace(/habit:|add habit/gi, '').trim();
    userState.habits.push({ habit, streak: 0, lastDone: null });
    return `🏆 Habit added: "${habit}"\n\nI go ask you about am every evening! Consistency na key oga 💪`;
  }

  if (msg.includes('did my habits') || msg.includes('habits done')) {
    userState.habits = userState.habits.map(h => ({ ...h, streak: h.streak + 1, lastDone: new Date() }));
    return `🔥 Habits marked done! Your streaks:\n\n${userState.habits.map(h => `• ${h.habit}: ${h.streak} day(s) 🔥`).join('\n')}\n\nYou dey try oga! Keep it up 💪`;
  }

  // Help
  if (msg === 'help' || msg === 'commands') {
    return `🤖 *Ade's Command List:*

📋 *To-Do:*
• "add to my list: [task]"
• "my list" — see your list
• "done 1" — mark task complete
• "clear list" — reset

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

Or just chat with me normally! I dey here 😄`;
  }

  // Default — send to AI
  return await getAIResponse(message);
}

// Webhook endpoint for incoming WhatsApp messages
app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || '';

  console.log(`Message from ${from}: ${incomingMsg}`);

  // Skip if focus mode (unless it's urgent)
  if (userState.focusMode && !incomingMsg.toLowerCase().includes('stop focus') && !incomingMsg.toLowerCase().includes('urgent')) {
    const reply = `🎯 You're in focus mode oga! I no wan disturb you.\n\nSend "stop focus" if you really need me 👀`;
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`);
    return;
  }

  try {
    const reply = await handleCommand(incomingMsg, from);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`);
  } catch (error) {
    console.error('Webhook error:', error);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Oga something break small 😅 Try again!</Message></Response>`);
  }
});

// Health check
app.get('/', (req, res) => res.send('Ade WhatsApp Bot is running! 🚀'));

// ============ SCHEDULED MESSAGES (Lagos time = UTC+1) ============

// Good morning + today's tasks (7:00 AM Lagos)
cron.schedule('0 6 * * *', async () => {
  const todos = userState.tomorrowTodos.length > 0 ? userState.tomorrowTodos : userState.todoList.filter(t => !t.done);
  const taskList = todos.length > 0
    ? todos.map((t, i) => `${i + 1}. ${t.task}`).join('\n')
    : 'No tasks set! Add some with "add to my list: [task]"';

  // Move tomorrow's todos to today
  if (userState.tomorrowTodos.length > 0) {
    userState.todoList = userState.tomorrowTodos;
    userState.tomorrowTodos = [];
  }

  const morningMessages = [
    `🌅 Good morning Oga Muiz!\n\nAnother day, another opportunity to build the empire 🏆\n\n📋 *Today's Mission:*\n${taskList}\n\nYou ready? Let's go! 💪`,
    `☀️ Rise and shine oga! The hustle no dey sleep\n\n📋 *Your tasks for today:*\n${taskList}\n\nClipCast and Glitters won't build themselves 😂 Let's move!`,
    `🌄 Oga Muiz! Morning o!\n\nToday is another chance to be great 🔥\n\n📋 *Lock in on these:*\n${taskList}\n\nNo dulling! 💪`
  ];

  const msg = morningMessages[Math.floor(Math.random() * morningMessages.length)];
  await sendMessage(MY_WHATSAPP_NUMBER, msg);
}, { timezone: 'Africa/Lagos' });

// Midday check-in (12:00 PM Lagos)
cron.schedule('0 11 * * *', async () => {
  const pending = userState.todoList.filter(t => !t.done);
  const done = userState.todoList.filter(t => t.done);

  const checkIns = [
    `👀 Oga how far? Afternoon don reach o!\n\n✅ Done: ${done.length}\n⬜ Remaining: ${pending.length}\n\nYou dey try? 😄`,
    `🕛 Afternoon check-in! How the hustle dey go?\n\n${pending.length > 0 ? `Still get ${pending.length} task(s) remaining o! E don do? 😅` : 'You don finish everything?! Oga you be machine! 🔥'}`,
    `🍽️ You don chop? Good! Now back to work 😂\n\n${pending.length} task(s) still pending. The list no go finish itself oga!`
  ];

  await sendMessage(MY_WHATSAPP_NUMBER, checkIns[Math.floor(Math.random() * checkIns.length)]);
}, { timezone: 'Africa/Lagos' });

// Evening recap (8:00 PM Lagos)
cron.schedule('0 19 * * *', async () => {
  const done = userState.todoList.filter(t => t.done).length;
  const total = userState.todoList.length;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;

  let verdict = '';
  if (percentage === 100) verdict = '🏆 100%! Oga you be legend! Nobody fit tell you anything today!';
  else if (percentage >= 75) verdict = `💪 ${percentage}%! Solid performance! Small small you go get there!`;
  else if (percentage >= 50) verdict = `😅 ${percentage}%... Half half. Tomorrow we do better oga!`;
  else if (percentage > 0) verdict = `😂 Only ${percentage}%?! Oga wetin happen?! We need to talk!`;
  else verdict = '😭 Zero tasks done?! Oga I no fit hold this one. What happened today?!';

  const msg = `🌙 *Evening Recap*\n\n${verdict}\n\n✅ Completed: ${done}/${total} tasks\n\nNow plan for tomorrow! What you go do? Send me your list 📋`;
  await sendMessage(MY_WHATSAPP_NUMBER, msg);
}, { timezone: 'Africa/Lagos' });

// Tomorrow planning prompt (9:00 PM Lagos)
cron.schedule('0 20 * * *', async () => {
  const prompts = [
    "🔮 Oga! Tomorrow loading... What's the plan? Drop your tasks and let's lock in 🔒",
    "📅 E don reach to plan tomorrow o! What we attacking? Send me your list! 💪",
    "🌙 Night time planning session! Tomorrow won't plan itself oga 😄 What's on the agenda?"
  ];
  await sendMessage(MY_WHATSAPP_NUMBER, prompts[Math.floor(Math.random() * prompts.length)]);
}, { timezone: 'Africa/Lagos' });

// Habit check (9:30 PM Lagos)
cron.schedule('30 20 * * *', async () => {
  if (userState.habits.length > 0) {
    const habitList = userState.habits.map(h => `• ${h.habit} (streak: ${h.streak} days 🔥)`).join('\n');
    await sendMessage(MY_WHATSAPP_NUMBER, `🏆 *Daily Habit Check!*\n\n${habitList}\n\nYou do all of them today? Reply "did my habits" to update your streak! 💪`);
  }
}, { timezone: 'Africa/Lagos' });

// Monday morning goals (7:30 AM Lagos, Mondays only)
cron.schedule('30 6 * * 1', async () => {
  await sendMessage(MY_WHATSAPP_NUMBER, `🎯 *Monday Morning! New Week Energy!*\n\nOga what are your 3 main goals for this week?\n\nSend: "weekly goals: goal1, goal2, goal3"\n\nLet's make this week count! 🔥`);
}, { timezone: 'Africa/Lagos' });

// Friday goal review (6:00 PM Lagos, Fridays only)
cron.schedule('0 17 * * 5', async () => {
  if (userState.weeklyGoals.length > 0) {
    const goalList = userState.weeklyGoals.map((g, i) => `${g.done ? '✅' : '❓'} ${i + 1}. ${g.goal}`).join('\n');
    await sendMessage(MY_WHATSAPP_NUMBER, `📊 *Friday Review Time!*\n\nOga how the week go?\n\n${goalList}\n\nWhich ones you actually do? Be honest now 😂\n\nReply with the numbers you completed!`);
  } else {
    await sendMessage(MY_WHATSAPP_NUMBER, `📊 *Friday Review!*\n\nOga you never set weekly goals this week 😅\n\nNext Monday, send: "weekly goals: goal1, goal2, goal3"\n\nWeekend don reach! Rest well 🙏`);
  }
}, { timezone: 'Africa/Lagos' });

// Weekly idea summary (Sunday 10 AM Lagos)
cron.schedule('0 9 * * 0', async () => {
  if (userState.ideas.length > 0) {
    const recentIdeas = userState.ideas.slice(-5);
    const list = recentIdeas.map((i, idx) => `${idx + 1}. ${i.idea}`).join('\n');
    await sendMessage(MY_WHATSAPP_NUMBER, `💡 *Weekly Idea Review!*\n\nOga here are your recent ideas from the vault:\n\n${list}\n\nWhich one worth pursuing? Think about am this week! 🧠`);
  }
}, { timezone: 'Africa/Lagos' });

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ade WhatsApp Bot running on port ${PORT} 🚀`);
  console.log('Waiting for messages...');
});
