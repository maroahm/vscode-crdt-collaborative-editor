// @ts-nocheck
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');

function activate(context) {
    console.log('HTTP/3 Collaborative Session Extension Activated!');

    let localDoc = new Y.Doc();
    //intializing a shared text type that will hold the document content. This is what we will sync across users.
    let yText = localDoc.getText('vscode-editor-sync');
    let awareness = new awarenessProtocol.Awareness(localDoc);
    //it represents the counter fo the mutex lock we will use to prevent infinite update loops when 
    // applying remote changes to the editor. Whenever we receive a remote update, we will increment 
    // this counter before applying the change, and then decrement it after. When we detect a local 
    // change, if this counter is greater than 0, it means it's a change that originated from a remote 
    // update, so we will ignore it and just decrement the counter.
    let remoteUpdateLock = 0;
    let proxyPanel = null;
    let sharedDocumentUri = null;
    let cursorDecorations = new Map(); // Tracks remote cursors to draw/clear them


    let sessionCommand = vscode.commands.registerCommand('collaborativetexteditor.manageSession', async () => {
        
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('❌ Please open a text file first before starting a session!');
            return;
        }
        sharedDocumentUri = activeEditor.document.uri.toString();

        const action = await vscode.window.showQuickPick(['📝 Create New Room', '🔗 Join Existing Room'], {
            placeHolder: 'Do you want to host a session or join one?'
        });

        if (!action) return; 

        const userName = await vscode.window.showInputBox({
            prompt: 'Enter your Display Name for this session',
            placeHolder: 'e.g., Omar'
        });

        if (!userName) return; 

        const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        awareness.setLocalStateField('user', { name: userName, color: myColor });

        let roomId = "";

        if (action === '📝 Create New Room') {
            const randomHash = Math.random().toString(36).substring(2, 10);
            roomId = `thesis-${randomHash}`;
            await vscode.env.clipboard.writeText(roomId);
            
            const initialText = activeEditor.document.getText();
            if (initialText.length > 0) yText.insert(0, initialText);
            
            vscode.window.showInformationMessage(`Room Created! ID: ${roomId} (Copied to Clipboard)`);
        } 
        else if (action === '🔗 Join Existing Room') {
            roomId = await vscode.window.showInputBox({ prompt: 'Enter the Room ID' });
            if (!roomId) return; 
            const newDoc = await vscode.workspace.openTextDocument({
                content: '',
                language: activeEditor.document.languageId
            })
            const newEditor = await vscode.window.showTextDocument(newDoc);
            sharedDocumentUri = newEditor.document.uri.toString();
            vscode.window.showInformationMessage(`Joining room: ${roomId}...`);
        }
        
        startNetworkProxy(context, roomId);
    });

    context.subscriptions.push(sessionCommand);

    function startNetworkProxy(context, roomId) {
        if (proxyPanel) {
            proxyPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        proxyPanel = vscode.window.createWebviewPanel(
            'http3Proxy', `HTTP/3 Proxy (${roomId})`, vscode.ViewColumn.Beside, 
            { enableScripts: true, retainContextWhenHidden: true }
        );

        // CLEANUP: If the user closes the proxy tab, reset our variable!
        proxyPanel.onDidDispose(() => {
            proxyPanel = null;
        }, null, context.subscriptions);

        proxyPanel.webview.html = fs.readFileSync(path.join(context.extensionPath, 'network-proxy.html'), 'utf8');

        // --- ROUTER: INCOMING FROM NETWORK ---
        proxyPanel.webview.onDidReceiveMessage(message => {
            if (message.type === 'status') {
                vscode.window.showInformationMessage(message.message);
            } else if (message.type === 'incoming-msg') {
                const payload = message.payload;
                if (payload.type === 'doc') {
                    Y.applyUpdate(localDoc, new Uint8Array(payload.data));
                } else if (payload.type === 'awareness') {
                    awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(payload.data), 'network');
                }
            }
        });

        // --- ROUTER: OUTGOING TO NETWORK ---
        // 1. Send Yjs Document math
        localDoc.on('update', (update, origin) => {
            // SAFETY CHECK: Ensure proxyPanel isn't null before sending!
            if (origin === 'vscode-local' && proxyPanel) {
                proxyPanel.webview.postMessage({ 
                    type: 'send-msg', 
                    payload: { type: 'doc', data: Array.from(update) } 
                });
            }
        });

        // 2. Send Awareness math
        awareness.on('update', ({ added, updated, removed }, origin) => {
            // SAFETY CHECK: Ensure proxyPanel isn't null before sending!
            if (origin === 'local' && proxyPanel) {
                const changedClients = added.concat(updated, removed);
                const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
                proxyPanel.webview.postMessage({ 
                    type: 'send-msg', 
                    payload: { type: 'awareness', data: Array.from(update) } 
                });
            }
        });

        proxyPanel.webview.postMessage({ type: 'connect', roomId: roomId });
    }

    // --- CURSOR LOGIC: Send my cursor position to the network ---
    vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor.document.uri.toString() !== sharedDocumentUri) return;
        
        // Find exact character index of the cursor
        const offset = event.textEditor.document.offsetAt(event.selections[0].active);
        const relativePos = Y.createRelativePositionFromTypeIndex(yText, offset);
        const encodedPos = Array.from(Y.encodeRelativePosition(relativePos));

        awareness.setLocalStateField('cursor', {encodedData: encodedPos,index: offset });
    });

    awareness.on('change', () => {
        
        // 1. Update the HTML Sidebar Dashboard
        if (proxyPanel) {
            const states = Array.from(awareness.getStates().entries());
            const activeUsers = states
                .filter(([id, state]) => state.user) 
                .map(([id, state]) => ({
                    name: state.user.name,
                    color: state.user.color,
                    isMe: id === awareness.clientID
                }));
            proxyPanel.webview.postMessage({ type: 'update-users', users: activeUsers });
        }

        const targetEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === sharedDocumentUri);
        if (!targetEditor) return;

        awareness.getStates().forEach((state, clientId) => {
            if (clientId === awareness.clientID) return; 

            if (!state.cursor || !state.user || !state.cursor.encodedData) {
                if (cursorDecorations.has(clientId)) {
                    cursorDecorations.get(clientId).dispose();
                    cursorDecorations.delete(clientId);
                }
                return;
            }

            try {
                // 1. Decode the mathematical CRDT position 
                const decodedArray = new Uint8Array(state.cursor.encodedData);
                const relativePos = Y.decodeRelativePosition(decodedArray);
                const absolutePos = Y.createAbsolutePositionFromRelativePosition(relativePos, localDoc);
                
                if (absolutePos !== null) {
                    const safeIndex = absolutePos.index;

                    // 2. Draw the undeniable 1-character block using the mathematically correct index
                    const startPos = targetEditor.document.positionAt(safeIndex);
                    
                    const endPos = targetEditor.document.positionAt(safeIndex); 
                    const range = new vscode.Range(startPos, endPos); 
                    
                    if (!cursorDecorations.has(clientId)) {
                        const newDec = vscode.window.createTextEditorDecorationType({
                            backgroundColor: `${state.user.color}80`, // 50% transparent block
                            border: `1px solid ${state.user.color}`
                        });
                        cursorDecorations.set(clientId, newDec);
                    }

                    const cursorDec = cursorDecorations.get(clientId);
                    targetEditor.setDecorations(cursorDec, [range]);
                }
            } catch (e) {
                console.log('Failed to map CRDT cursor.');
            }
        });
    });

    // --- TEXT LOGIC: INCOMING ---
    yText.observe(event => {
        if (event.transaction.origin === 'vscode-local') return;
        const targetEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === sharedDocumentUri);
        if (!targetEditor) return;

        // LOCK THE MUTEX
        remoteUpdateLock++; 

        targetEditor.edit(editBuilder => {
            let originalIndex = 0;
            event.delta.forEach(op => {
                if (op.retain){ 
                    originalIndex += op.retain;
                }else if (op.insert && typeof op.insert === 'string') {
                    editBuilder.insert(targetEditor.document.positionAt(originalIndex), op.insert);
                } 
                else if (op.delete) {
                    const startPos = targetEditor.document.positionAt(originalIndex);
                    const endPos = targetEditor.document.positionAt(originalIndex + op.delete);
                    editBuilder.delete(new vscode.Range(startPos, endPos));
                }
            });
        }, { undoStopBefore: false, undoStopAfter: false });
    });

    // --- TEXT LOGIC: OUTGOING ---
    vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() !== sharedDocumentUri) return;

        // CHECK THE MUTEX
        if (remoteUpdateLock > 0) {
            remoteUpdateLock--;
            return; 
        }

        localDoc.transact(() => {
            event.contentChanges.forEach(change => {
                if (change.rangeLength > 0) yText.delete(change.rangeOffset, change.rangeLength);
                if (change.text.length > 0) yText.insert(change.rangeOffset, change.text);
            });
        }, 'vscode-local'); 
    });


    
}

function deactivate() {}

module.exports = { activate, deactivate };