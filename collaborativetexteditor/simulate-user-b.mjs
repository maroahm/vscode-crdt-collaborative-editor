import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import readline from 'readline';

console.log('🟢 User B (Terminal Client) Booting Up...');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the 6-character room code to join: ', (roomCode) => {
    
    const code = roomCode.trim().toUpperCase();
    console.log(`\nAttempting to connect to Room: ${code}...`);

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('shared-file');

    const wsProvider = new WebsocketProvider(
      'ws://localhost:3000',
      code,
      ydoc,
      { WebSocketPolyfill: WebSocket }
    );

    wsProvider.on('status', event => {
        console.log(`[Network]: ${event.status}`);
        if (event.status === 'connected') {
            console.log('\n--- TERMINAL CHAT ACTIVE ---');
            console.log('Type your message and press ENTER to send to VS Code.\n');
        }
    const awareness = wsProvider.awareness;

    awareness.on('change', ({ added, updated, removed }) => {
        
        const changedClients = added.concat(updated);

        changedClients.forEach(clientID => {
            if (clientID !== awareness.clientID) {
                
                const state = awareness.getStates().get(clientID);
                
                if (state && state.cursorData) {
                    const tripLatency = Date.now() - state.cursorData.timestamp;
                    console.log(`⏱️ [TCP LATENCY]: VS Code Cursor at Line ${state.cursorData.line}, Char ${state.cursorData.character} | Trip took: ${tripLatency}ms`);
                }
            }
        });
    });
    });

    ytext.observe(event => {
        console.clear();
        
        console.log('🟢 Room Code:', code, '| LIVE DOCUMENT MIRROR');
        console.log('Type your text and press ENTER to append to the document.\n');
        console.log('=========================================');
        console.log(ytext.toString()); 
        console.log('=========================================\n');
    });

    rl.on('line', (input) => {
        const text = input.trim();

        if (text.startsWith('/del ')) {
            const parts = text.split(' ');
            if (parts.length === 3) {
                const index = parseInt(parts[1], 10);
                const length = parseInt(parts[2], 10);
                
                if (!isNaN(index) && !isNaN(length)) {
                    ydoc.transact(() => {
                        ytext.delete(index, length);
                    }, 'terminal');
                    rl.prompt();
                    return; 
                }
            }
            console.log('⚠️ Invalid command. Format: /del [starting_index] [number_of_characters]');
        } else {
            ydoc.transact(() => {
                ytext.insert(ytext.length, text + '\n');
            }, 'terminal'); 
        }
        
        rl.prompt();
    });

   
});