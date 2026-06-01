const fs = require('fs');
const https = require('https');
const TOKEN = fs.readFileSync('/tmp/imgy_bot_token.txt', 'utf-8').trim();

function tgApi(m,b) {
  return new Promise((rs,rj) => {
    const p = JSON.stringify(b||{});
    const r = https.request({hostname:'api.telegram.org',path:'/bot'+TOKEN+'/'+m,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}}, s => { let d=''; s.on('data',c=>d+=c); s.on('end',()=>rs(JSON.parse(d))); });
    r.on('error',rj); r.write(p); r.end();
  });
}

(async () => {
  // Check if user_2 has a chat with the bot
  const upd = await tgApi('getUpdates', {offset:0, timeout:3});
  console.log('Updates:', upd.result?.length || 0);
  
  // Try sending to user_2
  const snd = await tgApi('sendMessage', {chat_id: 8709533766, text: '👋 Привет! Напиши /start чтобы начать генерацию аватарок'});
  console.log('Send to 8709533766:', snd.ok, snd.description || '');
  if (!snd.ok) console.log(JSON.stringify(snd));
  
  // Check bot info
  const me = await tgApi('getMe');
  console.log('Bot:', me.result?.username);
})();
