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
  const upd = await tgApi('getUpdates', {offset:0, timeout:10});
  console.log('Updates:', upd.ok, 'count:', upd.result?.length || 0);
  if (upd.result?.length) {
    upd.result.slice(-10).forEach(u => {
      const from = u.message?.from || u.callback_query?.from || {};
      console.log('  ID:', u.update_id, '| From:', from.id, from.username||'', '| Text:', (u.message?.text || u.callback_query?.data || '(media)').substring(0,40));
    });
    console.log('Last offset:', upd.result[upd.result.length-1].update_id);
  }
  if (!upd.ok) console.log('Error:', upd.description);
})();
