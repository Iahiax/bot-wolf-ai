import { createServer } from 'http';

const PORT = process.env.PORT || 8080;

createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Wolf Bot is running ✅');
}).listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});
