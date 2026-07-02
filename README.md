# Ade - Muiz's WhatsApp AI Assistant 🤖

## Setup Instructions

### 1. Update your phone number in .env
Replace `+2348XXXXXXXXX` with your actual WhatsApp number including country code
Example: `+2348012345678`

### 2. Deploy to Railway
1. Go to railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Upload these files or connect GitHub
4. Add all environment variables from .env file
5. Railway will give you a public URL

### 3. Set Webhook in Twilio
1. Go to Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. Click "Sandbox Settings"  
3. In "When a message comes in" field, paste your Railway URL + /webhook
   Example: https://your-app.railway.app/webhook
4. Save

### 4. Test it!
Send any message to your Twilio WhatsApp number and Ade will reply!

## Commands
- "help" — see all commands
- "add to my list: [task]" — add todo
- "my list" — see todos
- "done 1" — mark task complete
- "idea: [idea]" — save to vault
- "spent 5000 on food" — track expense
- "focus mode 2 hours" — focus session
- "weekly goals: goal1, goal2" — set goals
- "habit: [habit]" — add habit tracker
