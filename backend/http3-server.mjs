import { readFile } from 'node:fs/promises';
import { Http3Server } from '@fails-components/webtransport';
import * as Y from 'yjs';

const activeRooms = new Map();
const CERT_DIR = '/etc/letsencrypt/live/omar-thesis.duckdns.org';

async function startWebTransportServer() {
    console.log('Booting HTTP/3 Yjs Multiplexing Server...');

    try {
        const key = await readFile('/etc/letsencrypt/live/omar-thesis.duckdns.org/privkey.pem');
        const cert = await readFile('/etc/letsencrypt/live/omar-thesis.duckdns.org/fullchain.pem');

        const h3Server = new Http3Server({
            port: 4433,
            host: '0.0.0.0',
            secret: 'thesis-secret-key',
            cert: cert,
            privKey: key,
        });

        h3Server.startServer();
        console.log('WebTransport Router running on https://0.0.0.0:4433/yjs-router');

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

// Reads until the first '\n'. Returns that line plus any bytes after it.
async function readFirstLine(reader) {
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) return null;
        buf += decoder.decode(value, { stream: true });
        const i = buf.indexOf('\n');
        if (i !== -1) {
            return { line: buf.slice(0, i).trim(), rest: buf.slice(i + 1) };
        }
    }
}

async function handleClientSession(session) {
    let room = null;
    let clientInfo = null;

    try {
        await session.ready;

        const bidiReader = session.incomingBidirectionalStreams.getReader();
        const { done, value: textStream } = await bidiReader.read();
        if (done) return;

        const textReader = textStream.readable.getReader();
        const textWriter = textStream.writable.getWriter();

        const first = await readFirstLine(textReader);
        if (!first || !first.line) return;
        const roomId = first.line;
        console.log(`\nUser joined room: [${roomId}]`);

        if (!activeRooms.has(roomId)) {
            activeRooms.set(roomId, { doc: new Y.Doc(), clients: new Set() });
        }
        room = activeRooms.get(roomId);

        const datagramWriter = session.datagrams.writable.getWriter();
        clientInfo = { textWriter, datagramWriter, session };
        room.clients.add(clientInfo);

        session.closed
            .catch(() => {})
            .finally(() => {
                room.clients.delete(clientInfo);
                console.log('Peer disconnected.');
            });

        const fullState = Y.encodeStateAsUpdate(room.doc);
        const syncMsg = JSON.stringify({ type: 'doc', data: Array.from(fullState) }) + '\n';
        await textWriter.write(new TextEncoder().encode(syncMsg));

        handleReliableText(textReader, clientInfo, room, first.rest);
        handleUnreliableDatagrams(session, clientInfo, room);
    } catch (error) {
        if (room && clientInfo) room.clients.delete(clientInfo);
        console.log('Peer disconnected.', error?.message ?? '');
    }
}

async function handleReliableText(reader, senderClient, room, initialBuffer = '') {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = initialBuffer;

    const processBuffer = () => {
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep the incomplete tail

        for (const line of lines) {
            if (!line) continue;

            try {
                const msg = JSON.parse(line);

                // Latency probe: echo straight back to the sender, never broadcast
                if (msg.type === 'ping') {
                    const pong = encoder.encode(
                        JSON.stringify({ type: 'pong', clientTime: msg.clientTime }) + '\n'
                    );
                    senderClient.textWriter.write(pong).catch(() => {});
                    continue;
                }

                if (msg.type === 'doc') {
                    Y.applyUpdate(room.doc, new Uint8Array(msg.data));
                }

                const outData = encoder.encode(line + '\n');
                for (const client of room.clients) {
                    if (client !== senderClient) {
                        client.textWriter.write(outData).catch(() => room.clients.delete(client));
                    }
                }
            } catch (e) {
                console.log('Parse error on text stream.');
            }
        }
    };

    try {
        processBuffer(); // anything that arrived together with the room ID

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            processBuffer();
        }
    } catch (error) {
        console.log('Text stream closed.');
    } finally {
        room.clients.delete(senderClient);
    }
}

async function handleUnreliableDatagrams(session, senderClient, room) {
    const datagramReader = session.datagrams.readable.getReader();

    try {
        while (true) {
            const { done, value } = await datagramReader.read();
            if (done) break;

            for (const client of room.clients) {
                if (client !== senderClient) {
                    client.datagramWriter.write(value).catch(() => {});
                }
            }
        }
    } catch (error) {
        console.log('Datagram stream closed.');
    }
}

startWebTransportServer();