import crypto from 'node:crypto';
import fs from 'node:fs';

// 1. Read the certificate you generated
const certPem = fs.readFileSync('cert.pem');

// 2. Parse it and extract the raw binary data (DER format)
const cert = new crypto.X509Certificate(certPem);
const rawDer = cert.raw;

// 3. Hash the binary data using SHA-256
const hash = crypto.createHash('sha256').update(rawDer).digest();

// 4. Print the exact JavaScript we need for the browser
console.log(`
=========================================
🔥 COPY THIS EXACT CODE INTO CHROME 🔥
=========================================

async function testNativeWebTransport() {
    console.log("Initiating Native HTTP/3 QUIC Handshake...");
    try {
        // The cryptographic fingerprint of your specific cert.pem
        const hashArray = new Uint8Array([${hash.join(', ')}]);
        
        const transport = new WebTransport('https://127.0.0.1:4433/yjs-room', {
            // Explicitly whitelist this exact certificate
            serverCertificateHashes: [{ algorithm: "sha-256", value: hashArray }]
        });
        
        await transport.ready;
        console.log("🔥 SUCCESS: Secure HTTP/3 Connection Established directly from the browser!");
        
        setTimeout(() => transport.close(), 5000);
    } catch (error) {
        console.error("❌ Handshake Failed:", error);
    }
}
testNativeWebTransport();
`);