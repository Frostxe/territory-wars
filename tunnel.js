const localtunnel = require('localtunnel');

(async () => {
  try {
    const tunnel = await localtunnel({ port: 3000 });
    console.log(`\n=========================================`);
    console.log(`🌐 ПУБЛИЧНАЯ ССЫЛКА ДЛЯ ИГРЫ:`);
    console.log(`${tunnel.url}`);
    console.log(`=========================================\n`);

    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });

    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err);
    });
  } catch (err) {
    console.error('Failed to create tunnel:', err);
  }
})();
