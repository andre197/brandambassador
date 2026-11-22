// Startup file for cPanel "Setup Node.js App". The host loads it with require(), so this
// small CommonJS file hands over to the real (ES module) server.
import('./server.mjs').catch((err) => {
  console.error('Brand Ambassador failed to start:\n', err);
  process.exit(1);
});
