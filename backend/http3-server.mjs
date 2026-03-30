import { readFile } from 'node:fs/promises';
import { Http3Server } from '@fails-components/webtransport';
import * as Y from 'yjs';

// Central memory bank for all active collaborative rooms
// Maps RoomID -> { doc: Y.Doc, clients: Set<Writers> }
const activeRooms = new Map();

async function startWebTransportServer() {
    console.log('Booting HTTP/3 Yjs Multiplexing Server...');

    try {
        const key = await readFile('../collaborativetexteditor/key.pem');
        const cert = await readFile('../collaborativetexteditor/cert.pem');

        const h3Server = new Http3Server({
            port: 4433,
            host: '127.0.0.1',
            secret: 'thesis-secret-key', 
            cert: cert,
            privKey: key,
        });

        h3Server.startServer();
        console.log('WebTransport Router running on https://127.0.0.1:4433/yjs-router');
        
        // ALL clients connect to this single router endpoint
        const sessionStream = h3Server.sessionStream('/yjs-router');
        const sessionReader = sessionStream.getReader();

        while (true) {
            const { done, value: session } = await sessionReader.read();
            if (done) break;
            handleClientSession(session);
        }

    } catch (error) {
        console.error('Server Error:', error);
    }
}

async function handleClientSession(session) {
    try {
        const bidiReader = session.incomingBidirectionalStreams.getReader();
        while (true) {
            const { done, value: stream } = await bidiReader.read();
            if (done) break;
            
            const reader = stream.readable.getReader();
            const writer = stream.writable.getWriter();
            
            // The NDJSON Buffer
            const decoder = new TextDecoder();
            let buffer = '';
            let roomId = null;
            let room = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // Add the new chunk to our running buffer
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep the last incomplete chunk in the buffer!
                
                for (const line of lines) {
                    if (!line) continue;
                    
                    // A. THE HANDSHAKE (The very first line is the Room ID)
                    if (!roomId) {
                        roomId = line;
                        console.log(`\n🚪 User joined room: [${roomId}]`);
                        if (!activeRooms.has(roomId)) {
                            activeRooms.set(roomId, { doc: new Y.Doc(), clients: new Set() });
                        }
                        room = activeRooms.get(roomId);
                        room.clients.add(writer);
                        
                        // Send Initial State properly framed
                        const stateVector = Y.encodeStateAsUpdate(room.doc);
                        const syncMsg = JSON.stringify({ type: 'doc', data: Array.from(stateVector) }) + '\n';
                        await writer.write(new TextEncoder().encode(syncMsg));
                        continue;
                    }
                    
                    // B. NORMAL MESSAGES
                    try {
                        const msg = JSON.parse(line);
                        // Apply Document math to the server's master copy
                        if (msg.type === 'doc') {
                            Y.applyUpdate(room.doc, new Uint8Array(msg.data));
                        }
                        
                        // Broadcast the framed line to everyone else
                        const outData = new TextEncoder().encode(line + '\n');
                        for (const clientWriter of room.clients) {
                            if (clientWriter !== writer) {
                                clientWriter.write(outData).catch(() => room.clients.delete(clientWriter));
                            }
                        }
                    } catch (e) {
                        console.log("Parse error, skipping chunk.");
                    }
                }
            }
        }
    } catch (error) {
        console.log('⚠️ Peer disconnected.');
    }
}

startWebTransportServer();