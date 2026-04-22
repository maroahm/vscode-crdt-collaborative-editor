// @ts-nocheck
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');



//UI Tree Class

class SessionExplorerProvider{
    constructor(workspaceMap){
        this.workspaceMap = workspaceMap;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        
        this.workspaceMap.observe(()=>{
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element){
        return element;
    }
    getChildren(element){
        if(element) return Promise.resolve([]);
        const files = Array.from(this.workspaceMap.keys());
        return Promise.resolve(files.map(fileName=>{
            const item = new vscode.TreeItem(fileName,vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('file-code');
            item.contextValue = 'sharedFile';
            item.command = {
                command:'collaborativetexteditor.openSharedFile',
                title:'Open File',
                arguments: [fileName]
            };
            return item;
        }));
    }
}

// --- CORE LOGIC CLASSES ---

// Note: The NetworkProxy class is responsible for managing the webview panel that acts as the HTTP/3 proxy interface. 
// It handles all communication between the collaborative session and the proxy, including sending document updates, 
// awareness states, and receiving messages from the proxy to update the Yjs document and awareness accordingly.
class NetworkProxy {
    constructor() {
        this.proxyPanel = null;
    }

    startNetworkProxy(context, roomId, localDoc, awareness, cursorDecorations) {
        if (this.proxyPanel) {
            this.proxyPanel.reveal(vscode.ViewColumn.Beside);
            this.proxyPanel.webview.postMessage({ type: 'connect', roomId: roomId });
            return;
        }

        this.proxyPanel = vscode.window.createWebviewPanel(
            'http3Proxy', `HTTP/3 Proxy (${roomId})`, vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this.proxyPanel.onDidDispose(() => {
            awareness.setLocalState(null);
            cursorDecorations.forEach(dec => dec.dispose());
            cursorDecorations.clear();
            this.proxyPanel = null;
        }, null, context.subscriptions);

        this.proxyPanel.webview.html = fs.readFileSync(path.join(context.extensionPath, 'network-proxy.html'), 'utf8');

        this.proxyPanel.webview.onDidReceiveMessage(message => {
            if (message.type === 'status') {
                vscode.window.showInformationMessage(message.message);
            } else if (message.type === 'network-connected') {
                if (this.proxyPanel) {
                    this.proxyPanel.webview.postMessage({ type: 'send-msg', payload: { type: 'request-sync' } });
                }
            } else if (message.type === 'incoming-msg') {
                const payload = message.payload;
                if (payload.type === 'doc') {
                    Y.applyUpdate(localDoc, new Uint8Array(payload.data), 'network');
                } else if (payload.type === 'awareness') {
                    awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(payload.data), 'network');
                } else if (payload.type === 'request-sync') {
                    const fullState = Y.encodeStateAsUpdate(localDoc);
                    if (this.proxyPanel) {
                        this.proxyPanel.webview.postMessage({
                            type: 'send-msg',
                            payload: { type: 'doc', data: Array.from(fullState) }
                        });
                    }
                }
            } else if (message.type === 'request-disconnect') {
                awareness.setLocalState(null);
                cursorDecorations.forEach(dec => dec.dispose());
                cursorDecorations.clear();
                setTimeout(() => {
                    if (this.proxyPanel) {
                        this.proxyPanel.webview.postMessage({ type: 'execute-disconnect' });
                        vscode.window.showInformationMessage('Disconnected from session.');
                    }
                }, 100);
            }
        });

        localDoc.on('update', (update, origin) => {
            if (origin !== 'network' && this.proxyPanel) {
                this.proxyPanel.webview.postMessage({
                    type: 'send-msg',
                    payload: { type: 'doc', data: Array.from(update) }
                });
            }
        });

        awareness.on('update', ({ added, updated, removed }, origin) => {
            if (origin === 'local' && this.proxyPanel) {
                const changedClients = added.concat(updated, removed);
                const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
                this.proxyPanel.webview.postMessage({
                    type: 'send-msg',
                    payload: { type: 'awareness', data: Array.from(update) }
                });
            }
        });
    

        awareness.on('change', ()=>{
            if(this.proxyPanel){
                const states = Array.from(awareness.getStates().entries());
                const activeUsers = states.filter(([id, state])=>state.user).map(([id, state])=>({
                    name: state.user.name,
                    color: state.user.color,
                    isMe: id === awareness.clientID
                }));
                this.proxyPanel.webview.postMessage({ type: 'update-users', users: activeUsers });
            }
        });

        this.proxyPanel.webview.postMessage({ type: 'connect', roomId: roomId });
    }
}
// The CollaborativeSession class manages the Yjs document, awareness states, and the logic for synchronizing text and 
// cursor positions across collaborators.
class CollaborativeSession {
    constructor() {
        this.localDoc = new Y.Doc();
        this.awareness = new awarenessProtocol.Awareness(this.localDoc);
        this.sharedWorkspace = this.localDoc.getMap('workspace-files');
        
        this.activeSharedFileName = null;
        this.activeYText = null;
        this.remoteUpdateLock = 0;
        this.sharedDocumentUri = null;
        this.cursorDecorations = new Map();

        this.setupTextObservers();
        this.setupCursorObservers();
    }

    async createRoom(userName) {
        const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        this.awareness.setLocalStateField('user', { name: userName, color: myColor });

        const randomHash = Math.random().toString(36).substring(2, 10);
        const roomId = `thesis-${randomHash}`;
        await vscode.env.clipboard.writeText(roomId);

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const fileName = path.basename(activeEditor.document.uri.fsPath);
            const initialText = activeEditor.document.getText();
            const newFileText = new Y.Text();
            if (initialText.length > 0) newFileText.insert(0, initialText);
            
            this.sharedWorkspace.set(fileName, newFileText);
            this.activeYText = newFileText;
            this.sharedDocumentUri = activeEditor.document.uri.toString();
            this.activeSharedFileName = fileName;
            this.activeYText.observe(this.incomingTextObserver);
        }
        vscode.window.showInformationMessage(`Room Created! ID: ${roomId} (copied to clipboard)`);
        return roomId;
    }

    async joinRoom(roomId, userName) {
        const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        this.awareness.setLocalStateField('user', { name: userName, color: myColor });
        vscode.window.showInformationMessage(`Joining Room: ${roomId}...`);
        return roomId;
    }

    async createSharedFile(fileName) {
        const newFileText = new Y.Text();
        this.sharedWorkspace.set(fileName, newFileText);
        vscode.window.showInformationMessage(`Created ${fileName} in shared workspace!`);
    }

    async openSharedFile(fileName) {
        if (this.activeYText) {
            this.activeYText.unobserve(this.incomingTextObserver);
        }

        this.activeSharedFileName = fileName;
        this.activeYText = this.sharedWorkspace.get(fileName);
        const uri = vscode.Uri.parse(`untitled:${fileName}`);

        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(uri, fullRange, this.activeYText.toString());
        await vscode.workspace.applyEdit(edit);
        
        await vscode.window.showTextDocument(doc);
        this.sharedDocumentUri = doc.uri.toString();
        this.activeYText.observe(this.incomingTextObserver);
        vscode.window.showInformationMessage(`Switched to: ${fileName}`);
    }

    // --- TEXT LOGIC ---
    setupTextObservers() {
        this.incomingTextObserver = (event) => {
            if (event.transaction.origin === 'vscode-local') return;

            const targetEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.sharedDocumentUri);
            if (!targetEditor) return;

            this.remoteUpdateLock++;

            targetEditor.edit(editBuilder => {
                let originalIndex = 0;
                event.delta.forEach(op => {
                    if (op.retain) {
                        originalIndex += op.retain;
                    } else if (op.insert && typeof op.insert === 'string') {
                        editBuilder.insert(targetEditor.document.positionAt(originalIndex), op.insert);
                    } else if (op.delete) {
                        const startPos = targetEditor.document.positionAt(originalIndex);
                        const endPos = targetEditor.document.positionAt(originalIndex + op.delete);
                        editBuilder.delete(new vscode.Range(startPos, endPos));
                    }
                }, { undoStopBefore: false, undoStopAfter: false });
            });
        };

        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() !== this.sharedDocumentUri || !this.activeYText) return;

            if (this.remoteUpdateLock > 0) {
                this.remoteUpdateLock--;
                return;
            }

            this.localDoc.transact(() => {
                event.contentChanges.forEach(change => {
                    if (change.rangeLength > 0) this.activeYText.delete(change.rangeOffset, change.rangeLength);
                    if (change.text.length > 0) this.activeYText.insert(change.rangeOffset, change.text);
                });
            }, 'vscode-local');
        });
    }

    // --- CURSOR LOGIC ---
    setupCursorObservers() {
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor.document.uri.toString() !== this.sharedDocumentUri || !this.activeYText) return;

            const offset = event.textEditor.document.offsetAt(event.selections[0].active);
            const relativePos = Y.createRelativePositionFromTypeIndex(this.activeYText, offset);
            const encodedPos = Array.from(Y.encodeRelativePosition(relativePos));

            this.awareness.setLocalStateField('cursor', { encodedData: encodedPos, index: offset, fileName: this.activeSharedFileName });
        });

        this.awareness.on('change', ({ added, updated, removed }) => {
            removed.forEach(clientId => {
                if (this.cursorDecorations.has(clientId)) {
                    this.cursorDecorations.get(clientId).dispose();
                    this.cursorDecorations.delete(clientId);
                }
            });

            // Note: Sending proxy UI updates is handled in NetworkProxy via awareness observer there.

            const targetEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.sharedDocumentUri);
            if (!targetEditor) return;

            this.awareness.getStates().forEach((state, clientId) => {
                if (clientId === this.awareness.clientID) return;

                if (!state.cursor || !state.user || !state.cursor.encodedData || state.cursor.fileName !== this.activeSharedFileName) {
                    if (this.cursorDecorations.has(clientId)) {
                        this.cursorDecorations.get(clientId).dispose();
                        this.cursorDecorations.delete(clientId);
                    }
                    return;
                }

                try {
                    const decodedArray = new Uint8Array(state.cursor.encodedData);
                    const relativePos = Y.decodeRelativePosition(decodedArray);
                    const absolutePos = Y.createAbsolutePositionFromRelativePosition(relativePos, this.localDoc);

                    if (absolutePos !== null) {
                        const safeIndex = absolutePos.index;
                        const startPos = targetEditor.document.positionAt(safeIndex);
                        const endPos = targetEditor.document.positionAt(safeIndex);
                        const range = new vscode.Range(startPos, endPos);

                        if (!this.cursorDecorations.has(clientId)) {
                            const newDec = vscode.window.createTextEditorDecorationType({
                                backgroundColor: `${state.user.color}80`,
                                border: `1px solid ${state.user.color}`
                            });
                            this.cursorDecorations.set(clientId, newDec);
                        }

                        const cursorDec = this.cursorDecorations.get(clientId);
                        targetEditor.setDecorations(cursorDec, [range]);
                    }
                } catch (e) {
                    console.log('Failed to map CRDT cursor.');
                }
            });
        });
    }
}

// --- EXTENSION ACTIVATION ---
// The activate function is the main entry point for the VSCode extension. It initializes the collaborative session, sets 
// up the network proxy, and registers all necessary commands for managing sessions and shared files.
function activate(context) {
    console.log('HTTP/3 Collaborative Session Extension Activated!');

    const session = new CollaborativeSession();
    const networkProxy = new NetworkProxy();

    const sessionProvider = new SessionExplorerProvider(session.sharedWorkspace);
    vscode.window.registerTreeDataProvider('sharedSessionExplorer', sessionProvider);

    let sessionCommand = vscode.commands.registerCommand('collaborativetexteditor.manageSession', async () => {
        const action = await vscode.window.showQuickPick(['📝 Create New Room', '🔗 Join Existing Room'], {
            placeHolder: 'Do you want to host a session or join one?'
        });
        if (!action) return;

        const userName = await vscode.window.showInputBox({
            prompt: 'Enter your Display Name for this session',
            placeHolder: 'e.g. Alice, Bob, etc.'
        });
        if (!userName) return;

        let roomId = "";
        if (action === '📝 Create New Room') {
            roomId = await session.createRoom(userName);
        } else if (action === '🔗 Join Existing Room') {
            roomId = await vscode.window.showInputBox({
                prompt: 'Enter the Room ID to join (ask your collaborator for this)',
                placeHolder: 'e.g. thesis-abc12345'
            });
            if (!roomId) return;
            roomId = await session.joinRoom(roomId, userName);
        }

        // Pass everything to your exact startNetworkProxy function
        networkProxy.startNetworkProxy(context, roomId, session.localDoc, session.awareness, session.cursorDecorations);
    });

    let createFileCommand = vscode.commands.registerCommand('collaborativetexteditor.createFile', async () => {
        const fileName = await vscode.window.showInputBox({ prompt: 'Enter a name for the shared file' });
        if (!fileName) return;
        await session.createSharedFile(fileName);
    });

    let openFileCommand = vscode.commands.registerCommand('collaborativetexteditor.openSharedFile', async (fileName) => {
        await session.openSharedFile(fileName);
    });
    let deleteFileCommand = vscode.commands.registerCommand('collaborativetexteditor.deleteSharedFile', (node) => {
        if(!node){
            vscode.window.showErrorMessage('No file selected to delete!');
            return;
        }
        const fileName = typeof node === 'string' ? node : node.label;

        if(session.sharedWorkspace.has(fileName)){
            session.sharedWorkspace.delete(fileName);
            vscode.window.showInformationMessage(`Deleted shared file: ${fileName}`);
        }

    });

    context.subscriptions.push(sessionCommand);
    context.subscriptions.push(createFileCommand);
    context.subscriptions.push(openFileCommand);
    context.subscriptions.push(deleteFileCommand);
}

function deactivate() {}

module.exports = { activate, deactivate };