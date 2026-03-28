import { WebTransport } from '@fails-components/webtransport';

async function testConnection() {
    console.log("Initiating HTTP/3 QUIC Handshake...");

    try {
        const url = 'https://127.0.0.1:4433/yjs-room';
        
        const transport = new WebTransport(url);
        
        await transport.ready;
        
        console.log("🔥 SUCCESS: Secure HTTP/3 Connection Established!");
        
        transport.close();
        
    } catch (error) {
        console.error("❌ Handshake Failed:", error);
    }
}

testConnection();