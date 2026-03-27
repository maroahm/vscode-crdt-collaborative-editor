import { WebSocketServer } from 'ws';

const PORT = 3000;
const wss = new WebSocketServer({ port: PORT });

console.log(`🚀 Signaling Server starting on port ${PORT}...`);

wss.on('connection', (ws) => {
    console.log('🟢 New client connected!');

    ws.on('message', (message, isBinary) => {
        console.log(`recieved message: ${message.length}`);
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) {
                client.send(message, {binary: isBinary});
            }
        });
    });

    ws.on('close', () => {
        console.log('🔴 Client disconnected');
    });
});