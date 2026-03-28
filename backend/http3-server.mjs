import { readFile } from 'node:fs/promises';
import { Http3Server } from '@fails-components/webtransport';

async function startWebTransportServer() {
    console.log('Booting HTTP/3 QUIC Server...');

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
        console.log('🚀 WebTransport Server running securely on https://127.0.0.1:4433');
        
        const sessionStream = h3Server.sessionStream('/yjs-room');
        const sessionReader = sessionStream.getReader();

        console.log('Waiting for clients to connect...');

        while (true) {
            const { done, value: session } = await sessionReader.read();
            if (done) break;
            
            console.log('\n✅ New WebTransport Client Connected!');
            
            handleClientSession(session);
        }

    } catch (error) {
        console.error('❌ Failed to start HTTP/3 Server:', error);
    }
}

// --- NEW: The Data Pipe Handler ---
async function handleClientSession(session) {
    try {
        // L
        // isten for new bidirectional streams opened by the client
        const bidiReader = session.incomingBidirectionalStreams.getReader();
        
        while (true) {
            const { done, value: stream } = await bidiReader.read();
            if (done) break;
            
            console.log('🌊 New QUIC Bidirectional Stream Opened!');
            
            // Setup readers and writers for this specific stream
            const reader = stream.readable.getReader();
            const writer = stream.writable.getWriter();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();

            // Continuously listen for incoming messages on this stream
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // Decode the raw binary buffer back into text
                const message = decoder.decode(value);
                console.log(`📩 Received from Client: "${message}"`);

                // Instantly shoot a reply back down the UDP tunnel
                const reply = `Server ACK: I received "${message}" in record time!`;
                await writer.write(encoder.encode(reply));
            }
        }
    } catch (error) {
        console.log('⚠️ Session closed or errored.');
    }
}

startWebTransportServer();