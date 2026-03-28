const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Y = require('yjs');

function activate(context) {
    console.log('🔥 HTTP/3 UI Extension Activated!');

    let localDoc = new Y.Doc();
    let yText = localDoc.getText('vscode-editor-sync');
    let isApplyingRemoteUpdate = false;
    let proxyPanel = null;

// --- COMMAND: Manage Session (Create or Join) ---
    let sessionCommand = vscode.commands.registerCommand('collaborativetexteditor.manageSession', async () => {
        
        const action = await vscode.window.showQuickPick(['📝 Create New Room', '🔗 Join Existing Room'], {
            placeHolder: 'Do you want to host a session or join one?'
        });

        if (!action) return; 

        let roomId = "";

        if (action === '📝 Create New Room') {
            // Option 1: Auto-generate a secure 8-character ID
            const randomHash = Math.random().toString(36).substring(2, 10);
            roomId = `thesis-${randomHash}`;
            
            // Magically copy it to the user's clipboard!
            await vscode.env.clipboard.writeText(roomId);
            
            vscode.window.showInformationMessage(`Room Created! ID: ${roomId} (Copied to Clipboard)`);
        } 
        else if (action === '🔗 Join Existing Room') {
            // Option 2: Let the guest paste the ID
            roomId = await vscode.window.showInputBox({
                prompt: 'Enter the Room ID your host gave you',
                placeHolder: 'thesis-a1b2c3d4'
            });

            if (!roomId) return; 
            vscode.window.showInformationMessage(`Joining room: ${roomId}...`);
        }
        
        // Boot up the Proxy and connect using the ID!
        startNetworkProxy(context, roomId);
    });

    context.subscriptions.push(sessionCommand);

    // --- THE NETWORK BOOT SEQUENCE ---
    function startNetworkProxy(context, roomId) {
        if (proxyPanel) {
            vscode.window.showWarningMessage('You are already in a session!');
            return;
        }

        // Create the hidden Webview
        proxyPanel = vscode.window.createWebviewPanel(
            'http3Proxy',
            `HTTP/3 Proxy (${roomId})`,
            vscode.ViewColumn.Beside, 
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const htmlPath = path.join(context.extensionPath, 'network-proxy.html');
        proxyPanel.webview.html = fs.readFileSync(htmlPath, 'utf8');

        // INCOMING NETWORK -> VS CODE
        proxyPanel.webview.onDidReceiveMessage(message => {
            if (message.type === 'status') {
                vscode.window.showInformationMessage(message.message);
            } else if (message.type === 'yjs-update') {
                const update = new Uint8Array(message.data);
                Y.applyUpdate(localDoc, update);
            }
        });

        // OUTGOING VS CODE -> NETWORK
        localDoc.on('update', (update, origin) => {
            if (origin === 'vscode-local') {
                proxyPanel.webview.postMessage({
                    type: 'send-yjs-update',
                    data: Array.from(update)
                });
            }
        });

        // Tell the proxy to connect to this specific room!
        // (We will update the HTML file to catch this next)
        // Tell the proxy to connect and pass the Room ID!
        proxyPanel.webview.postMessage({
            type: 'connect',
            roomId: roomId
        });
    }

    // --- THE EDITOR BINDING (Ghost Typing) ---
    yText.observe(event => {
        if (event.transaction.origin === 'vscode-local') return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        isApplyingRemoteUpdate = true; 

        editor.edit(editBuilder => {
            let currentIndex = 0;
            event.delta.forEach(op => {
                if (op.retain) {
                    currentIndex += op.retain;
                } else if (op.insert) {
                    const pos = editor.document.positionAt(currentIndex);
                    editBuilder.insert(pos, op.insert);
                    currentIndex += op.insert.length;
                } else if (op.delete) {
                    const startPos = editor.document.positionAt(currentIndex);
                    const endPos = editor.document.positionAt(currentIndex + op.delete);
                    editBuilder.delete(new vscode.Range(startPos, endPos));
                }
            });
        }, { undoStopBefore: false, undoStopAfter: false }).then(() => {
            isApplyingRemoteUpdate = false; 
        });
    });

    vscode.workspace.onDidChangeTextDocument(event => {
        if (isApplyingRemoteUpdate) return;
        
        const editor = vscode.window.activeTextEditor;
        if (!editor || event.document !== editor.document) return;

        localDoc.transact(() => {
            event.contentChanges.forEach(change => {
                if (change.rangeLength > 0) {
                    yText.delete(change.rangeOffset, change.rangeLength);
                }
                if (change.text.length > 0) {
                    yText.insert(change.rangeOffset, change.text);
                }
            });
        }, 'vscode-local'); 
    });
}

function deactivate() {}

module.exports = { activate, deactivate };