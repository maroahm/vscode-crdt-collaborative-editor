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
            
            // --- THE HANDSHAKE ---
            // The very first packet on this stream is ALWAYS the Room ID in plain text
            const { value: firstPacket } = await reader.read();
            const roomId = new TextDecoder().decode(firstPacket);
            
            console.log(`\n🚪 User joined room: [${roomId}]`);

            // If this room doesn't exist yet, create it!
            if (!activeRooms.has(roomId)) {
                console.log(`Creating new CRDT Document for [${roomId}]`);
                activeRooms.set(roomId, {
                    doc: new Y.Doc(),
                    clients: new Set()
                });
            }

            const room = activeRooms.get(roomId);
            room.clients.add(writer);

            // SYNC STEP 1: Send the current state of this specific room to the new user
            const stateVector = Y.encodeStateAsUpdate(room.doc);
            await writer.write(stateVector);

            // SYNC STEP 2: Listen for Yjs math and broadcast to this room only
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                Y.applyUpdate(room.doc, value);
                
                for (const clientWriter of room.clients) {
                    if (clientWriter !== writer) {
                        clientWriter.write(value).catch(() => {
                            room.clients.delete(clientWriter);
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.log('Peer disconnected.');
    }
}

startWebTransportServer();