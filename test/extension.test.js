const assert = require('assert');
const vscode = require('vscode');
const Y = require('yjs');

suite('HTTP/3 Collaborative Editor Test Suite', () => {
    vscode.window.showInformationMessage('Starting Extension Tests...');

    test('1. Extension should be present and activate successfully', async () => {
        // Fetches the extension using the publisher.name from your package.json
        const extension = vscode.extensions.getExtension('omar.collaborativetexteditor');
        assert.ok(extension, 'The extension should be present in the development host');

        // Force activation if it hasn't activated yet
        if (!extension.isActive) {
            await extension.activate();
        }
        
        assert.strictEqual(extension.isActive, true, 'The extension should successfully activate without throwing errors');
    });

    test('2. All core collaborative commands should be registered', async () => {
        // Fetch all commands currently recognized by VS Code
        const commands = await vscode.commands.getCommands(true);
        
        // The commands that are defined in extension.js and package.json
        const EXPECTED_COMMANDS = [
            'collaborativetexteditor.manageSession',
            'collaborativetexteditor.createFile',
            'collaborativetexteditor.openSharedFile',
            'collaborativetexteditor.deleteSharedFile'
        ];

        // Assert that every expected command exists in the environment
        for (const cmd of EXPECTED_COMMANDS) {
            assert.ok(commands.includes(cmd), `Critical Command missing: ${cmd}`);
        }
    });

    test('3. Yjs CRDT Workspace Data Model (Isolated Logic Test)', () => {
        // This tests the exact underlying Yjs logic utilized by the CollaborativeSession class
        const localDoc = new Y.Doc();
        const sharedWorkspace = localDoc.getMap('workspace-files');

        // Step A: Simulate creating a shared file
        const newFileText = new Y.Text();
        newFileText.insert(0, "const server = 'HTTP/3';");
        sharedWorkspace.set('backend.js', newFileText);

        assert.strictEqual(sharedWorkspace.has('backend.js'), true, 'The file should exist in the CRDT map');
        assert.strictEqual(sharedWorkspace.get('backend.js').toString(), "const server = 'HTTP/3';", 'The text content should match the insertion');

        // Step B: Simulate deleting a shared file
        sharedWorkspace.delete('backend.js');
        assert.strictEqual(sharedWorkspace.has('backend.js'), false, 'The file should be completely removed from the CRDT map upon deletion');
    });
});