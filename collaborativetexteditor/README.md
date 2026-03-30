# ⚡ Collaborative Text Editor (HTTP/3 + CRDT)

A high-performance, real-time collaborative text editor built as a VS Code Extension. This project explores the intersection of Conflict-Free Replicated Data Types (CRDTs) and next-generation web transport protocols (HTTP/3 WebTransport) to achieve ultra-low latency document synchronization and zero-distraction presence tracking.

### 🎥 Demo
https://github.com/user-attachments/assets/73da9297-1e06-4e02-9841-b6660cf899bc

---

## 🎯 Project Overview

Traditional collaborative editors rely on TCP-based WebSockets, which are susceptible to Application-Level Head-of-Line (HoL) blocking. If a large document update drops a packet, lightweight presence updates (like cursor movements) are forced to wait, creating UI lag. 

This thesis project bypasses TCP limitations by implementing **HTTP/3 WebTransport** over QUIC, multiplexing document state and awareness data across independent streams. State consistency is guaranteed via the **Yjs CRDT framework**, ensuring mathematically perfect eventual consistency without central locking mechanisms.

---

## 🏗️ Core Architectural Decisions

As part of the research and development of this extension, several critical architectural trade-offs were evaluated. Here is the documentation of why specific technical paths were chosen over alternatives:

### 1. Concurrency Control: Origin Mutex vs. Transaction Queue
* **The Problem:** VS Code applies text edits asynchronously. Incoming remote text locked the main thread, causing rapid local physical keystrokes to be dropped or overwritten.
* **The Decision (Chosen):** Implemented a shared **Origin Filter (Mutex Lock)**. The extension tracks the origin of text changes, allowing VS Code's native engine to handle local typing while strictly filtering out network echo.
* **Rejected Alternative:** A *Transaction Queue* (buffering local keystrokes to replay them later) was rejected because it introduces artificial typing latency, degrading the user experience.

### 2. Spatial Anchoring: Relative Positions vs. Absolute Integers
* **The Problem:** Cursors visually drifted to the wrong words when remote users inserted text above them, altering the document's absolute character count.
* **The Decision (Chosen):** Adopted **Yjs `RelativePosition` API**. Instead of transmitting static integer coordinates, cursors are mathematically bound to the unique ID of the underlying CRDT character node. As the text shifts, the cursor physically travels with its anchor node.
* **Rejected Alternative:** Transmitting *Raw Integers* (`index: 50`) was rejected because integers are stateless and instantly invalidate upon concurrent document mutations.

### 3. Presence UI: Minimalist Blocks vs. Floating Badges
* **The Problem:** Standard IDE collaborations use floating name badges for remote cursors, which overlap and obscure source code during high-frequency typing.
* **The Decision (Chosen):** Offloaded user identity mapping to a dedicated **HTTP/3 Proxy UI Sidebar**. In-editor presence is reduced to a clean, 1-character translucent block highlight, engineered specifically to bypass the Monaco engine's zero-width DOM optimization (which otherwise hides standard CSS carets at the End-of-File).
* **Rejected Alternative:** *Floating text badges* and *full-line highlighting* were rejected for creating unacceptable visual clutter and clashing with native syntax highlighters.

### 4. Initialization: Clean Slate vs. State Merging
* **The Problem:** Guests joining a live session with pre-existing local text inadvertently merged their local files with the host's master document, corrupting the CRDT state array.
* **The Decision (Chosen):** Enforced a **Clean Slate Protocol**. Upon joining a room, the extension automatically generates a blank, `Untitled` VS Code document to safely receive the host's master state.
* **Rejected Alternative:** *Overwriting the user's active file* was rejected as a destructive action that could result in permanent data loss.

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
