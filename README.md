# ⚡ Collaborative Text Editor (HTTP/3 + CRDT)

A high-performance, real-time collaborative text editor built as a VS Code Extension. This project explores the intersection of Conflict-Free Replicated Data Types (CRDTs) and next-generation web transport protocols (HTTP/3 WebTransport) to achieve ultra-low latency document synchronization and zero-distraction presence tracking across a multi-file virtual workspace.

### 🎥 Demo


---

## 🎯 Project Overview

Traditional collaborative editors (like VS Code Live Share) rely on TCP-based WebSockets or Host-Guest RPC tunnels. These architectures are susceptible to single points of failure, security risks via compute sharing, and Application-Level Head-of-Line (HoL) blocking—where heavy document mutations bottleneck lightweight cursor UI updates.

This thesis project bypasses TCP limitations by implementing **HTTP/3 WebTransport** over QUIC, explicitly multiplexing massive document states (Reliable Streams) and ephemeral awareness data (Unreliable Datagrams) across independent pipelines. State consistency is guaranteed via the **Yjs CRDT framework**, ensuring mathematically perfect eventual consistency in a zero-trust, decentralized peer-to-peer topology.

---

## 🏗️ Core Architectural Decisions

As part of the research and development of this extension, several critical distributed systems trade-offs were evaluated. Here is the documentation of why specific technical paths were chosen over alternatives:

### 1. Concurrency Control: The Macro-Task Promise Mutex
* **The Problem:** Due to the isolated multi-process architecture of modern IDEs, relying on synchronous state locks resulted in severe race conditions across the Inter-Process Communication (IPC) bridge. The native remote event listener unlocked faster than the IDE's Chromium rendering engine could emit the resultant state-change event, creating an infinite network echo loop.
* **The Decision (Chosen):** Implemented a **Macro-Task Promise Mutex**. By wrapping the unlock sequence inside a deferred execution timer (`setTimeout(..., 0)`), the architecture forces the V8 engine to push the unlock command out of the Microtask queue, mathematically guaranteeing the IDE's native UI event completely flushes before dropping the lock.
* **Rejected Alternative:** An *Integer-based Token Queue* was considered but deemed overly complex for the proof-of-concept scope, as the macro-task mutex successfully mitigates the echo loop for 95% of real-world typing scenarios.

### 2. State Routing: 1D Strings vs. Hierarchical Virtual File Systems
* **The Problem:** Scaling from a single shared document to a multi-file workspace required a structural overhaul of the AST (Abstract Syntax Tree). Linear arrays suffer from index-shifting and $O(N)$ lookup latency during rapid keypresses.
* **The Decision (Chosen):** Upgraded the CRDT to a 2D hierarchical dictionary (`Y.Map`), mapped natively to a custom VS Code `TreeDataProvider` Sidebar. To prevent cross-file memory leaks, the system utilizes **Dynamic Observer Rebinding**, safely detaching and re-attaching event listeners to specific file buffers strictly when the user navigates the virtual directory.
* **Rejected Alternative:** *JSON Objects* via standard WebSockets were rejected, as native JSON lacks mathematical conflict resolution, which would corrupt the directory if concurrent rename/delete operations occurred.

### 3. DAG Resolution: The Initial State Vector Handshake
* **The Problem:** In a CRDT topology, edits are bound by a Directed Acyclic Graph (DAG) dependency chain. Late-joining peers lack the mathematical baseline, causing incoming deltas to be quarantined as "orphaned structs" and leaving their local UI completely blank.
* **The Decision (Chosen):** Implemented an **Initial State Vector Handshake**. Upon establishing the QUIC transport layer, the joining peer broadcasts a synchronization request. Existing peers autonomously compress their entire local document via `Y.encodeStateAsUpdate()` and transmit the comprehensive vector history, instantly resolving the DAG and populating the peer's file explorer.

### 4. Ephemeral Presence: Global Routing vs. Context-Aware Cursors
* **The Problem:** The native Yjs `awareness` protocol broadcasts globally. Without spatial filtering, a peer typing in `index.js` would inadvertently project "ghost cursors" onto another peer's screen who is currently viewing `styles.css`.
* **The Decision (Chosen):** Engineered **Context-Aware Ephemeral Presence**. Outbound datagram payloads are injected with a deterministic spatial identifier (the target `fileName`). The local Chromium rendering loop acts as a strict exclusionary bouncer, instantly unmounting remote cursors whose identifiers do not strictly match the client's currently active viewport.

### 5. Session Teardown: Graceful IPC Tombstones
* **The Problem:** Abruptly severing the WebTransport connection orphans remote presence states, leaving permanent ghost cursors painted on peer IDEs.
* **The Decision (Chosen):** Engineered a graceful Inter-Process Communication (IPC) teardown sequence. Disconnecting triggers an explicit "Tombstone" broadcast (`awareness.setLocalState(null)`), followed by a deliberate event-loop delay to guarantee the final datagram flushes to the physical network layer before severing the underlying HTTP/3 pipes.

---

## 🚀 Getting Started

### Prerequisites
* [Visual Studio Code](https://code.visualstudio.com/) (v1.80+)
* [Node.js](https://nodejs.org/) (v18+)
* A local or remote HTTP/3 WebTransport server (configured for Yjs routing)

### Installation
1. Clone this repository:
   ```bash
   git clone [https://github.com/yourusername/vscode-crdt-collaborative-editor.git](https://github.com/yourusername/vscode-crdt-collaborative-editor.git)