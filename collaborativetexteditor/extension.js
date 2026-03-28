import * as vscode from 'vscode';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';

export async function activate(context) {
    console.log('🟢 Extension Activated! (Dynamic Routing Mode)');

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('shared-file');
    let wsProvider = null; 
    let isApplyingRemoteChange = false;

    function connectToServer(roomCode) {
        if (wsProvider) {
            vscode.window.showWarningMessage('You are already connected to a session!');
            return;
        }

        vscode.window.showInformationMessage(`Connecting to Room: ${roomCode}...`);

        wsProvider = new WebsocketProvider(
            'ws://localhost:3000',
            roomCode,
            ydoc,
            { WebSocketPolyfill: WebSocket }
        );

        wsProvider.on('status', event => {
            console.log(`[Network Status - Room ${roomCode}]: ${event.status}`); 
            if (event.status === 'connected') {
                vscode.window.showInformationMessage(`✅ Successfully joined session: ${roomCode}`);
            }
        });
        const awareness = wsProvider.awareness;

        vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = vscode.window.activeTextEditor;
            
            if (editor && event.textEditor === editor) {
                const position = editor.selection.active; 
                
                awareness.setLocalStateField('cursorData', {
                    line: position.line+1,
                    character: position.character,
                    timestamp: Date.now() 
                });
            }
        });
    }

    ytext.observe(event => {
        if (event.transaction.origin === 'vscode') return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const edit = new vscode.WorkspaceEdit();
        let originalDocOffset = 0; 
        
        for (const op of event.delta) {
            if (op.retain) {
                originalDocOffset += op.retain;
            } else if (op.insert) {
                const pos = editor.document.positionAt(originalDocOffset);
                edit.insert(editor.document.uri, pos, op.insert);
            } else if (op.delete) {
                const startPos = editor.document.positionAt(originalDocOffset);
                const endPos = editor.document.positionAt(originalDocOffset + op.delete);
                edit.delete(editor.document.uri, new vscode.Range(startPos, endPos));
                originalDocOffset += op.delete;
            }
        }

        isApplyingRemoteChange = true;
        vscode.workspace.applyEdit(edit).then(() => {
            setTimeout(() => { isApplyingRemoteChange = false; }, 10);
        });
    });

    vscode.workspace.onDidChangeTextDocument(event => {
        if (isApplyingRemoteChange || event.contentChanges.length === 0) return;

        ydoc.transact(() => {
            event.contentChanges.forEach(change => {
                if (change.rangeLength > 0) {
                    ytext.delete(change.rangeOffset, change.rangeLength);
                }
                if (change.text !== '') {
                    ytext.insert(change.rangeOffset, change.text);
                }
            });
        }, 'vscode'); 
    });

    let startSessionCommand = vscode.commands.registerCommand('collaborativetexteditor.helloWorld', async () => {
        
        const selection = await vscode.window.showInformationMessage(
            'Welcome to the Collaborative Editor! What would you like to do?',
            'Generate Room',
            'Join Room'
        );

        if (selection === 'Generate Room') {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            
            await vscode.env.clipboard.writeText(code);
            connectToServer(code);
            vscode.window.showInformationMessage(`Room created! Code '${code}' copied to clipboard.`);

        } else if (selection === 'Join Room') {
            const code = await vscode.window.showInputBox({
                prompt: 'Enter the 6-character room code to join',
                placeHolder: 'e.g. A7X9BQ'
            });

            if (code) {
                connectToServer(code.toUpperCase()); 
            }
        }
    });

    context.subscriptions.push(startSessionCommand);
}

export function deactivate() {
    console.log('🔴 Extension deactivated.');
}