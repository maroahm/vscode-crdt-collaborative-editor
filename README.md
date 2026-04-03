# Collaborative Text Editor (VS Code Extension)

**BSc Thesis Project:** An analysis of Real-Time Session Sharing using CRDTs over TCP (WebSockets) and UDP (WebTransport/HTTP3).

## 📌 Project Overview
This Visual Studio Code extension enables real-time, peer-to-peer collaborative editing using Conflict-free Replicated Data Types (CRDTs) via the Yjs framework. It utilizes a centralized Pub/Sub signaling server to achieve Strong Eventual Consistency across multiple distributed clients.

## 🚀 Current Architecture (Phase 1: TCP Baseline)
* **Frontend:** VS Code Extension API (Native UI routing)
* **CRDT Engine:** Yjs (Directed Acyclic Graph mathematical synchronization)
* **Transport Layer:** WebSockets (TCP)
* **Signaling Server:** Dockerized `y-websocket` broker
* **Testing Harness:** Node.js CLI Live Mirror (`simulate-user-b.mjs`)
* **Telemetry:** Yjs Awareness Protocol for ephemeral cursor tracking and latency measurement.

## 🛠️ How to Run the Environment Locally

### 1. Start the Signaling Server
You must have Docker installed. This spins up the centralized WebSocket broker on port 3000.
go to project root (Thesis folder) and then run:
```bash
docker-compose up -d
```
then go to collaborativetexteditor folder and run:
f5
ctrl+shift+p
and choose hello world

then run in your terminal in the same folder path
```bash
node simulated-user-b.mjs
```

and now you can continue testing by typing in both screens while 
they syncronize properly with cursor consistency 
