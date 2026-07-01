// start.js — JavaScript wrapper that runs the TypeScript chat-service using tsx
// WispByte runs: node /home/container/${JS_FILE}
// Set JS_FILE=start.js in WispByte environment variables

const { spawn } = require('child_process');
const path = require('path');

console.log('[start.js] Launching chat-service with tsx...');

const child = spawn('npx', ['tsx', path.join(__dirname, 'index.ts')], {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname,
  env: {
    ...process.env,
    // Ensure the tsx loader can find modules
    NODE_PATH: path.join(__dirname, 'node_modules'),
  },
});

child.on('exit', (code, signal) => {
  console.log(`[start.js] Child process exited with code ${code}, signal ${signal}`);
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('[start.js] Failed to start child process:', err);
  process.exit(1);
});

// Keep the parent process alive
process.stdin.resume();
