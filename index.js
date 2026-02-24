require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use a more robust model name or allow override
const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const model = genAI.getGenerativeModel({ model: modelName });

// Debug function to check available models (helps solve 404)
async function listModels() {
    try {
        console.log("Checking for available Gemini models...");
        // Note: listModels is not always available in all versions, 
        // but we'll try to at least log the current model being used.
        console.log(`Using model: ${modelName}`);
    } catch (e) {
        console.log("Could not list models, continuing...");
    }
}
listModels();

// In-memory state tracking (for production, use a database or file)
const userStates = {};

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        handleSIGINT: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP APP:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Bot is ready and listening!');
});

client.on('message', async (message) => {
    const sender = message.from;
    const body = message.body.trim();

    // Ignore group messages
    if (sender.includes('@g.us')) return;

    // Ignore messages FROM the owner themselves
    const owners = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER.split(',') : [];
    if (owners.some(num => sender.includes(num.trim()))) {
        console.log("Ignoring message from Owner.");
        return;
    }

    // Ignore EXCLUDED_NUMBERS
    const excluded = process.env.EXCLUDED_NUMBERS ? process.env.EXCLUDED_NUMBERS.split(',') : [];
    if (excluded.some(num => sender.includes(num.trim()))) {
        console.log(`Ignoring EXCLUDED number: ${sender}`);
        return;
    }

    // Handle Reset Command (For Ian to reset anyone)
    if (body.toLowerCase() === '!reset') {
        userStates[sender] = null;
        message.reply("Conversation state has been reset.");
        return;
    }

    // Get current state
    let state = userStates[sender];

    if (!state) {
        // First time interaction: Show Menu
        const menu = `Hello! This is Ian's personal assistant. How would you like to be helped?

1. Engage directly with Sir Ian.
2. Speak to Ian's automated AI assistant.

Please reply with 1 or 2.`;
        message.reply(menu);
        userStates[sender] = 'MENU';
        return;
    }

    if (state === 'MENU') {
        if (body === '1') {
            // Choice 1: Direct Human Interaction
            userStates[sender] = 'DIRECT';
            message.reply("Understood. I have notified Sir Ian. He will get back to you as soon as possible.");

            // Notification to Ian
            if (process.env.OWNER_NUMBER) {
                const owners = process.env.OWNER_NUMBER.split(',');
                owners.forEach(ownerNum => {
                    const ownerJid = `${ownerNum.trim()}@c.us`;
                    client.sendMessage(ownerJid, `🔔 *Notification:* ${sender.split('@')[0]} wants to talk to you directly!`);
                });
            }
            console.log(`Notification: User ${sender} wants direct contact.`);
            return;
        } else if (body === '2') {
            // Choice 2: AI Assistant
            userStates[sender] = 'AI';
            message.reply("Perfect! I am now Ian's AI assistant. How can I help you today?");
            return;
        } else {
            message.reply("Invalid choice. Please reply with 1 to talk to Sir Ian or 2 to talk to his AI assistant.");
            return;
        }
    }

    if (state === 'AI') {
        try {
            console.log(`Gemini thinking for ${sender}...`);
            const prompt = `${process.env.PERSONA_PROMPT}\n\nThe user says: "${body}"\n\nAssistant reply:`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim();

            console.log(`Replying with AI: ${text}`);
            const signature = process.env.AI_SIGNATURE ? `\n\n${process.env.AI_SIGNATURE}` : '';
            message.reply(text + signature);
        } catch (error) {
            console.error('ERROR WITH GEMINI API:', error);
            // More descriptive error for logging purposes
            if (error.message.includes('safety')) {
                console.log('Gemini blocked this message due to safety filters.');
            }
            message.reply("Sorry, I'm having trouble thinking right now. Please try again later.");
        }
    }

    if (state === 'DIRECT') {
        // Do nothing, let the human (Ian) handle it.
        console.log(`User ${sender} is in DIRECT mode. Ignoring for AI.`);
    }
});

client.initialize();
