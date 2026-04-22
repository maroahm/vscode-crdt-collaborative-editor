import { readFile } from 'node:fs/promises';
import { Http3Server } from '@fails-components/webtransport';
import * as Y from 'yjs';

const activeRooms = new Map();

async function startWebTransportServer() {
    console.log('Booting HTTP/3 Yjs Multiplexing Server...');

    try {
        const key = await readFile('./key.pem');
        const cert = await readFile('./cert.pem');


        const h3Server = new Http3Server({
            port: 4433,
            host: '0.0.0.0',
            secret: 'thesis-secret-key', 
            cert: cert,
            privKey: key,
        });

        h3Server.startServer();
        console.log('WebTransport Router running on https://0.0.0.0:4433/yjs-router');
        
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
        const {done, value: textStream} = await bidiReader.read();
        if(done) return;

        const textReader = textStream.readable.getReader();
        const textWriter = textStream.writable.getWriter();

        const decoder = new TextDecoder();
        const {value: handshakeValue} = await textReader.read();
        const roomId = decoder.decode(handshakeValue).trim();
        console.log(`\nUser joined room: [${roomId}]`);

        if(!activeRooms.has(roomId)) {
            activeRooms.set(roomId, { doc: new Y.Doc(), clients: new Set() });
        }
        const room = activeRooms.get(roomId);
        const clientInfo = {textWriter, session};
        room.clients.add(clientInfo);

        const stateVector = Y.encodeStateAsUpdate(room.doc);
        const syncMsg = JSON.stringify({type: 'doc', data: Array.from(stateVector)}) + '\n';
        await textWriter.write(new TextEncoder().encode(syncMsg));
        
        handleReliableText(textReader, clientInfo, room);

        handleUnreliableDatagrams(session, clientInfo, room);

    } catch (error) {
        console.log('Peer disconnected.');
    }
}

async function handleReliableText(reader, senderClient, room){
    const decoder = new TextDecoder();
    let buffer = '';

    try{
        while(true){
            const {done, value} = await reader.read();
            if(done) break;

            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split('\n');
            buffer = lines.pop();
            
            for(const line of lines){
                if(!line) continue;

                try{
                    const msg = JSON.parse(line);
                    if(msg.type === 'doc'){
                        Y.applyUpdate(room.doc, new Uint8Array(msg.data));
                    }
                    
                    const outData = new TextEncoder().encode(line + '\n');
                    for(const client of room.clients){
                        if(client !== senderClient){
                            client.textWriter.write(outData).catch(() => room.clients.delete(client));
                        }
                    }
                } catch(e){
                    console.log("Parse error on text stream.");
                }
            }
        }
    }catch(error){
        room.clients.delete(senderClient);
        console.log('Text stream closed.');
    }

}

async function handleUnreliableDatagrams(session, senderClient, room){
    const datagramReader = session.datagrams.readable.getReader();
    
    try{
        while(true){
            const {done, value} = await datagramReader.read();
            if(done) break;

            for(const client of room.clients){
                if(client !== senderClient){
                    try{
                        const datagramWriter = client.session.datagrams.writable.getWriter();
                        datagramWriter.write(value);
                        datagramWriter.releaseLock();
                    } catch(e){
                    }
                }
            }
        }
    }catch(error){
        console.log('Datagram stream closed.');
    }
}
startWebTransportServer();